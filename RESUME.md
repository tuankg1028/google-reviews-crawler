# Resume notes (updated 2026-11-08, run stopped by hand before laptop shutdown)

Goal: Google Maps reviews for the 42 places in `Review_MissingPlaces.xlsx`, only reviews dated 2022-01-01 .. 2026-06-30.
Output columns: `place_id, city, tripadvisor_name, google_name, author, rating, date, text`.

## Where the data is
- Latest combined CSV: `output/google-reviews-final-2026-11-08T10-15-50-064Z.csv` (45,887 reviews, 34 places). Rebuild any time with `npm run merge`.
- Per-place coverage: `output/coverage-report.csv` (rebuild with `node src/report.js`).
- Raw per-place data: `output/raw/rowNN-*.json` (finished) and `*.partial.json` (checkpoint, saved every 1000 loaded reviews; used by merge when no finished file exists).
- Logs: `batch-*.log` in the project root.

## Status at stop time (coverage report: 10 complete, 24 incomplete, 8 not collected)
- Complete: small places that loaded everything Google lists.
- Incomplete (collected as much as possible, user said "any amount is fine"): most large places. Scrolling newest-first stops after roughly 2,500-3,500 reviews, so for very busy places most loaded reviews are newer than 2026-06 and few fall in the date range.
- Done this session: row 11 Hon Thom Cable Car (2,740 loaded), row 34 Ba Na Hills Cable Car (2,790 loaded).
- Row 39 Vietnamese Women's Museum: only a checkpoint (`row39-*.partial.json`, about 2,000 of 6,903 loaded) because the run was stopped. Rerun it to finish (remove the partial file first, since SKIP_DONE only looks at finished `.json` files, so a rerun happens anyway).
- Row 42 Imperial Citadel of Thang Long: not run yet.
- Needs correct Google Maps links from the user (their links do not open a place with a Reviews tab): rows 3, 14, 31, 35, 38, 41 (Cham Island, Long Beach, Dragon Bridge, 3D Museum, Old Quarter, Dong Xuan Market). Or skip them.
- Row 7 duplicates row 6; row 9 is the same Google place as row 1 (do not collect again).
- Suspicious, worth a rerun: row 27 Notre Dame loaded only 20 of 29k; rows 10, 12, 20 loaded few reviews, all newer than 2026-06. Row 36 Han River Bridge uses a search link that resolves to a results list; confirm the right place.

## How to resume
AdsPower must be running, profile serial 2162 signed in to Google (the crawler attaches to it; do NOT connect other scripts to that browser while the batch runs, it dropped the connection).

```bash
# remaining places, no size limit, up to 3500 reviews each, skip places already saved
ADSPOWER_PROFILE_ID=2162 ONLY=39,42 MAX_PLACE_REVIEWS=0 MAX_REVIEWS=3500 SKIP_DONE=true npm run batch
npm run merge && node src/report.js
```
Env: `MAX_PLACE_REVIEWS=0` means no limit (default 2000 skips bigger places). `SORTS="Newest,Most relevant"` merges several sort orders (the "Highest/Lowest rating" menu items did not match; untested otherwise). `DATE_FROM` / `DATE_TO` change the range.

## Known problems
- Google shows only relative dates ("3 months ago"); the date filter keeps any review whose possible date window overlaps the range, so edge reviews can be wrongly kept.
- Review lists often stop loading early; no confirmed cause (Google limit vs. browser memory).
- The AdsPower browser sometimes closes mid-run; `batch.js` reconnects and retries a place up to 3 times.
