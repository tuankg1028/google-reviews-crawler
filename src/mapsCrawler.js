import { chromium } from 'playwright';
import { logger } from './utils/logger.js';

// Google Maps place-page scraper. Selectors are Maps-specific and will drift;
// adjust SEL when Google changes its markup.
const SEL = {
  resultLink: 'a.hfpxzc',
  title: 'h1.DUwDvf, h1',
  reviewsTab: 'button[role="tab"][aria-label*="Reviews" i], button[role="tab"]:has-text("Reviews")',
  sortButton: 'button[aria-label*="Sort" i]',
  newestItem: '[role="menuitemradio"]:has-text("Newest")',
  scroller: 'div.m6QErb.DxyBCb.kA9KIf.dS8AEf, div.m6QErb.DxyBCb',
  review: 'div.jftiEf[data-review-id]',
  moreButton: 'button.w8nwRe',
};

export class MapsCrawler {
  constructor({ headless = true, maxReviews = 100, scrollDelay = 1500, timeout = 45000, slowMo = 0, userDataDir = null, dateFrom = null, adspowerProfileId = null } = {}) {
    Object.assign(this, { headless, maxReviews, scrollDelay, timeout, slowMo, userDataDir, dateFrom, adspowerProfileId });
    this.browser = null;
    this.context = null;
  }

  async start() {
    const opts = {
      headless: this.headless,
      slowMo: this.slowMo,
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    };
    if (this.adspowerProfileId) {
      // Attach to an AdsPower profile through its local API (default port 50325). Sign in to Google
      // inside that profile yourself beforehand; the crawler reuses the session.
      const api = process.env.ADSPOWER_API || 'http://local.adspower.net:50325';
      const res = await (await fetch(`${api}/api/v1/browser/start?${/^\d+$/.test(this.adspowerProfileId) ? 'serial_number' : 'user_id'}=${this.adspowerProfileId}`)).json();
      if (res.code !== 0) throw new Error(`AdsPower start failed: ${res.msg}`);
      this.browser = await chromium.connectOverCDP(res.data.ws.puppeteer);
      this.context = this.browser.contexts()[0];
    } else if (this.userDataDir) {
      // Persistent profile: sign in to Google once (headed) and later runs reuse the session.
      this.context = await chromium.launchPersistentContext(this.userDataDir, { ...opts, channel: 'chrome' });
    } else {
      this.browser = await chromium.launch({ headless: opts.headless, slowMo: opts.slowMo });
      this.context = await this.browser.newContext(opts);
    }
  }

  // Drop a dead connection and attach again (AdsPower keeps the browser running).
  async reconnect() {
    logger.warn('Browser connection lost; reconnecting...');
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = null;
    this.browser = null;
    if (this.adspowerProfileId) {
      const api = process.env.ADSPOWER_API || 'http://local.adspower.net:50325';
      const q = /^\d+$/.test(this.adspowerProfileId) ? 'serial_number' : 'user_id';
      await fetch(`${api}/api/v1/browser/stop?${q}=${this.adspowerProfileId}`).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));
    }
    await this.start();
  }

  async close() {
    await this.context?.close();
    await this.browser?.close();
  }

  // Returns { placeName, finalUrl, cid, reviews }
  async crawlPlace(url) {
    const page = await this.context.newPage();
    try {
      await page.goto(withEnglish(url), { waitUntil: 'domcontentloaded', timeout: this.timeout });
      await this.dismissConsent(page);
      await this.resolveToPlace(page);

      // Prefer the place-title heading; plain "h1" can match the "Results" header of a search list.
      let placeName = (await page.locator('h1.DUwDvf').first().textContent({ timeout: 15000 }).catch(() => ''))?.trim() || '';
      if (!placeName) placeName = (await page.locator('h1:not(:has-text("Results"))').first().textContent({ timeout: 5000 }).catch(() => ''))?.trim() || '';
      const finalUrl = page.url();
      const cid = extractCid(finalUrl);

      return { placeName, finalUrl, cid, page };
    } catch (e) {
      await page.close();
      throw e;
    }
  }

  // Total Google review count shown on the place page (e.g. "29,589 reviews"), or null.
  async reviewCount(page) {
    const label = await page.locator('[aria-label$=" reviews"], [aria-label*=" reviews" i]').first().getAttribute('aria-label', { timeout: 5000 }).catch(() => null);
    const m = (label || '').match(/([\d,.]+)\s+reviews?/i);
    if (m) return parseInt(m[1].replace(/[,.]/g, ''));
    const text = await page.locator('body').innerText().catch(() => '');
    const t = text.match(/\(([\d,]+)\)/);
    return t ? parseInt(t[1].replace(/,/g, '')) : null;
  }

  // Call after crawlPlace once the caller has decided to proceed (e.g. not a duplicate CID).
  // Collects with each sort mode and merges by review id. One sort order stalls after ~3000 reviews, so
  // several orders (newest / highest / lowest / relevant) reach different parts of the list.
  async collectReviews(page, expected = null, sorts = ['Newest'], onPartial = null) {
    try {
      await this.openReviewsTab(page);
      const byId = new Map();
      for (const mode of sorts) {
        const sorted = await this.sortBy(page, mode);
        // If the first sort can't be applied, still collect in the page's default order instead of nothing.
        if (!sorted && byId.size > 0) continue;
        // Checkpoint every 1000 loaded reviews (not yet expanded) so a browser crash keeps what was loaded.
        const checkpoint = async () => {
          const snap = await this.extract(page);
          snap.forEach((r) => r.id && !byId.has(r.id) && byId.set(r.id, r));
          if (onPartial) await onPartial([...byId.values()]);
        };
        await this.scrollAll(page, expected, sorted && mode === 'Newest', checkpoint); // date early-stop only valid when newest-first
        await this.expandAll(page);
        const got = await this.extract(page);
        const before = byId.size;
        got.forEach((r) => r.id && !byId.has(r.id) && byId.set(r.id, r));
        logger.info(`Sort "${mode}": ${got.length} loaded, ${byId.size - before} new, ${byId.size} total unique`);
        if (onPartial) await onPartial([...byId.values()]); // persist progress so a crash cannot lose it
        if (expected && byId.size >= expected) break;
      }
      return [...byId.values()];
    } finally {
      await page.close();
    }
  }

  async dismissConsent(page) {
    if (!page.url().includes('consent.google')) return;
    const btn = page.locator('button:has-text("Accept all"), button:has-text("Reject all")').first();
    await btn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
  }

  // A search link lands on a results list (or directly on a place if there is one match).
  async resolveToPlace(page) {
    const first = await Promise.race([
      page.waitForSelector(SEL.resultLink, { timeout: 20000 }).then(() => 'list').catch(() => null),
      page.waitForSelector(SEL.reviewsTab, { timeout: 20000 }).then(() => 'place').catch(() => null),
    ]);
    if (first === 'list' && (await page.locator(SEL.reviewsTab).count()) === 0) {
      logger.info('Search results list detected; opening first result');
      await page.locator(SEL.resultLink).first().click();
    }
    await page.waitForSelector(SEL.reviewsTab, { timeout: 20000 });
  }

  async openReviewsTab(page) {
    await page.locator(SEL.reviewsTab).first().click();
    await page.waitForSelector(SEL.review, { timeout: 20000 });
  }

  // mode: "Newest" | "Highest rating" | "Lowest rating" | "Most relevant". Returns true if the sort was applied.
  async sortBy(page, mode) {
    try {
      await page.locator(SEL.sortButton).first().click({ timeout: 5000 });
      await page.locator(`[role="menuitemradio"]:has-text("${mode}")`).first().click({ timeout: 5000 });
      await page.waitForTimeout(2000);
      return true;
    } catch {
      logger.warn(`Could not switch sort to "${mode}"`);
      return false;
    }
  }

  async scrollAll(page, expected = null, useDateStop = true, onCheckpoint = null) {
    if (await page.getByText('limited view of Google Maps').count()) {
      logger.warn('Signed-out "limited view": Google only serves ~5 reviews. Set USER_DATA_DIR and sign in (see README/CLAUDE.md) for more.');
    }
    let prev = 0;
    let stagnant = 0;
    while (true) {
      const count = await page.locator(SEL.review).count();
      if (count >= this.maxReviews) break;
      if (expected && count >= expected) break; // everything Google lists is loaded
      if (useDateStop && this.dateFrom && count) {
        // Sorted newest-first: once the last loaded review predates dateFrom, nothing older is needed.
        const lastDate = await page.locator(SEL.review).last().locator('.rsqaWe').textContent().catch(() => '');
        const r = relativeRange(lastDate);
        // Stop only when even the newest possible date of the last review is before dateFrom.
        if (r && r.newest < this.dateFrom) break;
      }
      stagnant = count === prev ? stagnant + 1 : 0;
      // Loading can stall for a while; only give up after many patient retries (with a jiggle).
      if (stagnant >= 12) break;
      if (stagnant >= 3) {
        await page.mouse.wheel(0, -1500);
        await page.waitForTimeout(1500);
      }
      if (onCheckpoint && Math.floor(count / 1000) > Math.floor(prev / 1000)) await onCheckpoint().catch(() => {});
      if (Math.floor(count / 100) > Math.floor(prev / 100)) logger.info(`Progress: ${count}${expected ? '/' + expected : ''} reviews loaded`);
      prev = count;
      // Scroll the last loaded review into view (finds the scroll container on its own),
      // then nudge with the wheel to trigger lazy loading.
      await page.locator(SEL.review).last().scrollIntoViewIfNeeded().catch(() => {});
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(this.scrollDelay);
    }
    logger.info(`Loaded ${prev} review elements`);
  }

  async expandAll(page) {
    // Click every "More" button inside the page in one evaluate call (fast), instead of one
    // Playwright click per review, which took tens of minutes for thousands of reviews.
    const clicked = await page.evaluate((sel) => {
      const btns = document.querySelectorAll(sel);
      btns.forEach((b) => b.click());
      return btns.length;
    }, `${SEL.review} ${SEL.moreButton}`);
    logger.info(`Expanded ${clicked} truncated reviews`);
    await page.waitForTimeout(1500);
  }

  async extract(page) {
    const reviews = await page.$$eval(SEL.review, (els) =>
      els.map((el) => {
        const rating = el.querySelector('span.kvMYJc')?.getAttribute('aria-label') || '';
        return {
          id: el.getAttribute('data-review-id'),
          author: el.querySelector('.d4r55')?.textContent.trim() || 'Anonymous',
          rating: parseFloat(rating.match(/[\d.]+/)?.[0]) || null,
          date: el.querySelector('.rsqaWe')?.textContent.trim() || '',
          text: el.querySelector('.wiI7pd')?.textContent.trim() || '',
          helpful: el.querySelector('button[aria-label*="helpful" i]')?.textContent.trim() || null,
          extractedAt: new Date().toISOString(),
        };
      })
    );
    return reviews.slice(0, this.maxReviews);
  }
}

function withEnglish(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('google.com')) u.searchParams.set('hl', 'en');
    return u.toString();
  } catch {
    return url;
  }
}

// Google's place identity: the "0x...:0x..." feature id embedded in the place URL.
export function extractCid(url) {
  return url.match(/0x[0-9a-f]+:0x[0-9a-f]+/i)?.[0] || null;
}

// Google shows relative dates ("3 months ago", "a year ago"). Approximate absolute date; error grows with age
// (about +/-15 days for months, +/-6 months for years).
export function relativeToDate(text, now = new Date()) {
  const m = String(text).toLowerCase().match(/(a|an|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/);
  if (!m) return null;
  const n = m[1].startsWith('a') ? 1 : parseInt(m[1]);
  const days = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30.44, year: 365.25 }[m[2]];
  return new Date(now.getTime() - n * days * 86400000);
}

// Google's "N units ago" means elapsed time in [N, N+1) units ("a month ago" = 1 month to <2).
// Returns the possible date window { newest, oldest } so callers can include a review whenever the
// window overlaps the wanted range (never drop a boundary review by guessing).
export function relativeRange(text, now = new Date()) {
  const m = String(text).toLowerCase().match(/(a|an|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/);
  if (!m) return null;
  const n = m[1].startsWith('a') ? 1 : parseInt(m[1]);
  const days = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30.44, year: 365.25 }[m[2]];
  return { newest: new Date(now.getTime() - n * days * 86400000), oldest: new Date(now.getTime() - (n + 1) * days * 86400000) };
}
