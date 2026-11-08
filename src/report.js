import fs from 'fs/promises';
import XLSX from 'xlsx';
import { cityOf, csvCell } from './utils/places.js';
import { relativeRange } from './mapsCrawler.js';

// Coverage report: one line per sheet row saying what was collected and what is missing.
const dateFrom = new Date('2022-01-01');
const wb = XLSX.readFile('./Review_MissingPlaces.xlsx');
const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

// Google review counts and outcomes from every batch log (later logs override earlier ones).
const info = {};
for (const f of (await fs.readdir('.')).filter((x) => /^batch.*\.log$/.test(x)).sort()) {
  let row = null;
  for (const line of (await fs.readFile(f, 'utf8')).split('\n')) {
    const m = line.match(/--- Row (\d+):/);
    if (m) { row = +m[1]; info[row] ??= {}; continue; }
    const l = line.match(/Google lists (\d+) reviews/);
    if (l && row) info[row].listed = +l[1];
    const e = line.match(/\[ERROR\] .*?: failed: (.*)/);
    if (e && row) info[row].error = e[1].split('\n')[0].slice(0, 80);
  }
}
const raw = {};
const files = await fs.readdir('output/raw');
for (const f of files.filter((x) => x.endsWith('.json') && (!x.endsWith('.partial.json') || !files.includes(x.replace('.partial.json', '.json'))))) {
  const d = JSON.parse(await fs.readFile(`output/raw/${f}`, 'utf8'));
  raw[d.row ?? +f.match(/^row(\d+)/)[1]] = d;
}
const BAD_LINK = {
  3: 'link is a point on the sea, no review listing', 14: 'link opens an empty page', 31: 'link is only coordinates',
  35: 'link opens a photo, not the place page', 38: 'link is an area, no review listing', 41: 'link has no Reviews tab',
};

const rows = [];
sheet.forEach((r, i) => {
  const n = i + 1;
  if (!String(r[7] || '').startsWith('http')) return;
  const base = { row: n, city: cityOf(String(r[5] || ''), String(r[7] || '')), place: r[1], listed: info[n]?.listed ?? '' };
  const d = raw[n];
  if (d) {
    const last = d.reviews.at(-1)?.date || '';
    const w = relativeRange(last);
    const reachedBefore2022 = w && w.newest < dateFrom;
    const complete = d.reviews.length >= d.listed * 0.99 || reachedBefore2022;
    const kept = d.reviews.filter((v) => { const x = relativeRange(v.date); return !x || (x.oldest <= new Date('2026-06-30T23:59:59Z') && x.newest >= dateFrom); }).length;
    rows.push({ ...base, listed: d.listed, loaded: d.reviews.length, kept_in_range: kept, status: complete ? 'COMPLETE' : 'INCOMPLETE', note: complete ? '' : `stopped early at "${last}" (${d.listed - d.reviews.length} listed reviews not loaded)` });
  } else if (BAD_LINK[n]) rows.push({ ...base, loaded: 0, kept_in_range: 0, status: 'NOT COLLECTED', note: `needs correct Google Maps link: ${BAD_LINK[n]}` });
  else if (info[n]?.listed > 6000) rows.push({ ...base, loaded: 0, kept_in_range: 0, status: 'NOT COLLECTED', note: `skipped: ${info[n].listed} reviews (over 6000 limit)` });
  else rows.push({ ...base, loaded: 0, kept_in_range: 0, status: 'NOT COLLECTED', note: info[n]?.error ? `failed: ${info[n].error}` : 'duplicate link of an earlier row, collected once' });
});
const cols = ['row', 'city', 'place', 'listed', 'loaded', 'kept_in_range', 'status', 'note'];
const out = 'output/coverage-report.csv';
await fs.writeFile(out, '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n'));
const by = (s) => rows.filter((r) => r.status === s).length;
console.log(`${rows.length} rows: ${by('COMPLETE')} complete, ${by('INCOMPLETE')} incomplete, ${by('NOT COLLECTED')} not collected -> ${out}`);
rows.forEach((r) => console.log(`${String(r.row).padStart(2)} ${r.status.padEnd(13)} ${String(r.place).slice(0, 34).padEnd(34)} listed ${String(r.listed).padStart(5)} loaded ${String(r.loaded).padStart(5)} kept ${String(r.kept_in_range).padStart(5)}  ${r.note}`));
