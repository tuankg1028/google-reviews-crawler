import fs from 'fs/promises';
import path from 'path';
import XLSX from 'xlsx';
import { MapsCrawler, relativeRange } from './mapsCrawler.js';
import { exportData } from './utils/exporter.js';
import { logger } from './utils/logger.js';
import { cityOf, placeIdFromCid, csvCell, FINAL_COLS, makeInRange } from './utils/places.js';

// Usage: node src/batch.js [file.xlsx]
// Env: MAX_REVIEWS, HEADLESS (default false = visible browser), EXPORT_FORMATS, ONLY=3,5 (sheet row numbers),
//      USER_DATA_DIR=./.chrome-profile (persistent profile; sign in once with HEADLESS=false),
//      ADSPOWER_PROFILE_ID=<id> (attach to a signed-in AdsPower profile; AdsPower must be running),
//      SKIP_SEARCH_LINKS=true (skip /maps/search links), PLACE_DELAY_MS
// Sheet columns (no header row): B name, H Google Maps link, I resolved name, K status, L note.
const file = process.argv[2] || './Review_MissingPlaces.xlsx';
const outputDir = './output';
// Only keep reviews in [DATE_FROM, DATE_TO] (defaults: 2022-01-01 .. 2026-06-30). Review dates are relative
// ("3 months ago") so the boundaries are approximate. MAX_REVIEWS is a safety cap.
const dateFrom = new Date(process.env.DATE_FROM || '2022-01-01');
const dateTo = new Date((process.env.DATE_TO || '2026-06-30') + 'T23:59:59Z');
const maxReviews = parseInt(process.env.MAX_REVIEWS) || 5000;
const inRange = makeInRange(dateFrom, dateTo);
const formats = (process.env.EXPORT_FORMATS || 'json,csv').split(',');
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(Number)) : null;
const skipSearch = process.env.SKIP_SEARCH_LINKS === 'true';
// SORTS=Newest,Highest rating,Lowest rating,Most relevant : merge several sort orders (default Newest only)
const SORTS = (process.env.SORTS || 'Newest').split(',').map((x) => x.trim());
const maxPlaceReviews = process.env.MAX_PLACE_REVIEWS !== undefined ? parseInt(process.env.MAX_PLACE_REVIEWS) : 2000; // skip busier places (set 0 = no limit)
const placeDelay = parseInt(process.env.PLACE_DELAY_MS) || 4000;

const slug = (s) => s.normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

function readPlaces() {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const seenUrls = new Set();
  const places = [];
  rows.forEach((r, i) => {
    const row = i + 1;
    const url = String(r[7] || '').trim();
    if (!url.startsWith('http')) return;
    if (only && !only.has(row)) return;
    // Rows only differ by sheet position, not by place — collect each link once.
    if (seenUrls.has(url)) return void logger.info(`Row ${row}: duplicate link, skipping`);
    seenUrls.add(url);
    places.push({
      row,
      name: String(r[1] || '').trim(),
      resolvedName: String(r[8] || '').trim(),
      status: String(r[10] || '').trim(),
      note: String(r[11] || '').trim(),
      city: cityOf(String(r[5] || ''), url),
      url,
      isSearch: url.includes('/maps/search/'),
    });
  });
  return places;
}


// Opens a place, applies duplicate / size checks, and collects all reviews. Throws on browser problems.
async function collectPlace(crawler, p, entry) {
  const { placeName, finalUrl, cid, page } = await crawler.crawlPlace(p.url);
  Object.assign(entry, { googlePlace: placeName, finalUrl, cid });
  if (cid && seenCids.has(cid)) {
    await page.close();
    entry.outcome = `skipped: same Google place as row ${seenCids.get(cid)}`;
    logger.warn(`${p.name}: ${entry.outcome}`);
    return { skipped: true };
  }
  const total = await crawler.reviewCount(page);
  entry.googleReviewCount = total;
  logger.info(`${p.name}: Google lists ${total ?? 'unknown'} reviews`);
  if (maxPlaceReviews && total && total > maxPlaceReviews) {
    await page.close();
    entry.outcome = `skipped: ${total} reviews (> ${maxPlaceReviews}); rerun with MAX_PLACE_REVIEWS=0 to include`;
    logger.warn(`${p.name}: ${entry.outcome}`);
    return { skipped: true };
  }
  const all = await crawler.collectReviews(page, total, SORTS, async (partial) => {
    await fs.mkdir(path.join(outputDir, 'raw'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'raw', `row${String(p.row).padStart(2, '0')}-${slug(p.name)}.partial.json`), JSON.stringify({ row: p.row, tripadvisorName: p.name, city: p.city, googlePlace: placeName, cid, placeId: placeIdFromCid(cid), listed: total, loaded: partial.length, reviews: partial }));
  });
  return { placeName, cid, all, total };
}

const seenCids = new Map();

async function main() {
  const places = readPlaces();
  logger.info(`Loaded ${places.length} places from ${file}`);
  await fs.mkdir(outputDir, { recursive: true });

  const crawler = new MapsCrawler({ headless: process.env.HEADLESS === 'true', maxReviews, dateFrom, userDataDir: process.env.USER_DATA_DIR || null, adspowerProfileId: process.env.ADSPOWER_PROFILE_ID || null });
  await crawler.start();
  const summary = [];
  const finalRows = [];

  try {
    for (const p of places) {
      const entry = { row: p.row, name: p.name, url: p.url, status: p.status, outcome: '', reviews: 0 };
      summary.push(entry);

      const rawFile = path.join(outputDir, 'raw', `row${String(p.row).padStart(2, '0')}-${slug(p.name)}.json`);
      if (process.env.SKIP_DONE === 'true' && (await fs.stat(rawFile).catch(() => null))) {
        entry.outcome = 'skipped: already collected (SKIP_DONE)';
        continue;
      }
      if (p.isSearch && skipSearch) {
        entry.outcome = 'skipped: search link';
        continue;
      }

      try {
        logger.info(`--- Row ${p.row}: ${p.name} ---`);
        // Whole place (open + count + collect) is one retryable unit; a lost browser connection is re-attached.
        let result;
        for (let attempt = 1; ; attempt++) {
          try {
            result = await collectPlace(crawler, p, entry);
            break;
          } catch (e) {
            if (attempt >= 3) throw e;
            logger.warn(`${p.name}: attempt ${attempt} failed (${e.message.split('\n')[0]}), retrying`);
            if (/closed|disconnected|Target/i.test(e.message)) await crawler.reconnect().catch((err) => logger.error('reconnect failed:', err.message));
          }
        }
        if (result.skipped) continue;
        const { placeName, cid, all, total } = result;
        if (cid) seenCids.set(cid, p.row);
        const reviews = all.filter(inRange);
        await fs.mkdir(path.join(outputDir, 'raw'), { recursive: true });
        await fs.writeFile(path.join(outputDir, 'raw', `row${String(p.row).padStart(2, '0')}-${slug(p.name)}.json`), JSON.stringify({ row: p.row, tripadvisorName: p.name, city: p.city, googlePlace: placeName, cid, placeId: placeIdFromCid(cid), listed: total, loaded: all.length, reviews: all }, null, 2));
        if (process.env.DEBUG_DATES) console.log(all.slice(0, 25).map((r) => r.date).join(' | '));
        logger.info(`${p.name}: ${reviews.length}/${all.length} reviews within ${dateFrom.toISOString().slice(0, 10)}..${dateTo.toISOString().slice(0, 10)}`);
        entry.reviews = reviews.length;
        entry.outcome = reviews.length ? 'ok' : 'no reviews found';

        const place_id = placeIdFromCid(cid);
        for (const r of reviews) {
          finalRows.push({ place_id, city: p.city, tripadvisor_name: p.name, google_name: placeName, author: r.author, rating: r.rating, date: r.date, text: r.text });
        }
        const tagged = reviews.map((r) => ({ ...r, place: p.name, googlePlace: placeName, row: p.row }));
        for (const f of formats) await exportData(tagged, `row${String(p.row).padStart(2, '0')}-${slug(p.name)}`, f, outputDir);
      } catch (e) {
        entry.outcome = `failed: ${e.message.split('\n')[0]}`;
        logger.error(`${p.name}: ${entry.outcome}`);
      }
      await new Promise((r) => setTimeout(r, placeDelay));
    }
  } finally {
    await crawler.close();
    const finalPath = path.join(outputDir, `google-reviews-final-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    const csv = [FINAL_COLS.join(','), ...finalRows.map((r) => FINAL_COLS.map((c) => csvCell(r[c])).join(','))].join('\n');
    await fs.writeFile(finalPath, '\uFEFF' + csv, 'utf8');
    logger.info(`Final CSV (${finalRows.length} reviews) written to ${finalPath}`);
    const out = path.join(outputDir, `batch-summary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await fs.writeFile(out, JSON.stringify(summary, null, 2));
    logger.info(`Summary written to ${out}`);
    summary.forEach((s) => logger.info(`row ${s.row} ${s.name}: ${s.outcome} (${s.reviews})`));
  }
}

main().catch((e) => {
  logger.error('Batch failed:', e.message);
  process.exit(1);
});
