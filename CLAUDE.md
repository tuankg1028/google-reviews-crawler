# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install && npm run install-browsers   # install deps + Playwright browsers
npm start "<google-reviews-url>"          # run the crawler (node src/index.js)
npm run dev "<url>"                       # same, with node --watch
DEBUG=true LOG_LEVEL=debug npm start "<url>"   # verbose output + stack traces
```

There is no lint setup and no working test suite: `npm test` points to `src/test.js`, which doesn't exist, and `playwright.config.js` references a `./tests` dir that doesn't exist (it also uses `devices` without importing it, so it would fail if loaded).

Batch crawl of the places spreadsheet (Google Maps links in column H of `Review_MissingPlaces.xlsx`):

```bash
npm run batch                                   # all places
ONLY=4,5 MAX_REVIEWS=50 npm run batch           # only those sheet rows
SKIP_SEARCH_LINKS=true npm run batch            # skip unresolved /maps/search links
USER_DATA_DIR=./.chrome-profile npm run batch   # browser is visible by default (HEADLESS=true hides it); sign in to Google once, profile is reused
```

Batch env vars: `ADSPOWER_PROFILE_ID=<serial or id>` (attach to a signed-in AdsPower profile; preferred over `USER_DATA_DIR`), `MAX_PLACE_REVIEWS=0` (no per-place size limit; default skips places over 2000), `MAX_REVIEWS` (per-place cap), `SKIP_DONE=true` (skip places that already have `output/raw/rowNN-*.json`), `SORTS`, `DATE_FROM`/`DATE_TO` (default 2022-01-01..2026-06-30).
After a run: `npm run merge` builds the single final CSV from `output/raw/*.json`; `node src/report.js` writes `output/coverage-report.csv`. See `RESUME.md` for the current state of the crawl.

Output is written to `./output/<name>-<timestamp>.{json,csv}`.

## Architecture

ESM project (`"type": "module"`) — a Playwright (Chromium) scraper for Google Reviews. Flow:

- `src/index.js` — entry point. Reads URL from `argv[2]` (falls back to a hardcoded Sula Vineyards search URL), builds `GoogleReviewsCrawler` from env vars (`MAX_REVIEWS`, `HEADLESS`, `EXPORT_FORMATS`), runs `crawlReviews`, then `exportReviews`, and logs a summary.
- `src/reviewsCrawler.js` — `GoogleReviewsCrawler` class holds all logic: `initialize` (launch browser) → `navigateToReviews` (detects page type: search / maps / other, then `handleSearchPage` / `handleMapsPage` / `waitForReviewsWithFallback`) → `scrollToLoadAllReviews` → `expandAllReviews` → `extractReviewData`. `crawlReviews` wraps this in a retry loop.
- `src/config.js` — `CONFIG` defaults (delays, timeouts, retries, output dir) and the DOM `selectors`. Constructor options are shallow-merged over `CONFIG`. Google's DOM changes often, so scraping breakage is usually fixed here (and in the fallback selectors inside `reviewsCrawler.js`).
- `src/utils/exporter.js` — `exportData(data, filename, format, outputDir)` for json/csv; `src/utils/logger.js` — leveled logger.

Batch path (separate from the single-URL crawler above): `src/batch.js` reads the xlsx (no header row; B name, H Maps link, I resolved name, K status, L note), dedupes by link and by Google place id (`0x..:0x..` in the final URL), and uses `src/mapsCrawler.js`, which has Maps-specific selectors (`div.jftiEf[data-review-id]`, `.wiI7pd`, `.d4r55`, ...). It writes one file pair per place plus `output/batch-summary-*.json`. Search links open the first search result, so check `googlePlace` in the summary against the sheet notes.

Signed-out Google Maps shows a "limited view": only ~5 reviews, and "See more reviews" / "More" trigger a sign-in prompt. Getting more requires `USER_DATA_DIR` with a signed-in profile.

Gotchas:
- `HEADLESS` is parsed as `process.env.HEADLESS === 'true'`, so it defaults to headed mode when unset, regardless of `.env.example` or `CONFIG.headless`.
- `.env` is not loaded automatically (no dotenv); set variables inline in the shell.
- `index.js` exports under the hardcoded name `sula-vineyards-reviews` regardless of the target URL.
- `CONFIG.slowMo` is 1000ms, so runs are slow by design.
