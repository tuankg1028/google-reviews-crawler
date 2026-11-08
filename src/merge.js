import fs from 'fs/promises';
import path from 'path';
import XLSX from 'xlsx';
import { cityOf, placeIdFromCid, csvCell, FINAL_COLS, makeInRange } from './utils/places.js';

// Builds ONE final CSV from every output/raw/*.json (so results of several batch runs combine).
// Usage: node src/merge.js   Env: DATE_FROM, DATE_TO (default 2022-01-01 .. 2026-06-30)
const dateFrom = new Date(process.env.DATE_FROM || '2022-01-01');
const dateTo = new Date((process.env.DATE_TO || '2026-06-30') + 'T23:59:59Z');
const inRange = makeInRange(dateFrom, dateTo);
const wb = XLSX.readFile('./Review_MissingPlaces.xlsx');
const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

const all = await fs.readdir('output/raw');
// A finished place has <name>.json; an interrupted one only <name>.partial.json (used as a fallback).
const files = all.filter((f) => f.endsWith('.json') && (!f.endsWith('.partial.json') || !all.includes(f.replace('.partial.json', '.json')))).sort();
const rows = [];
const seen = new Set();
for (const f of files) {
  const d = JSON.parse(await fs.readFile(path.join('output/raw', f), 'utf8'));
  const rowNo = d.row ?? parseInt(f.match(/^row(\d+)/)[1]);
  const r = sheet[rowNo - 1] || [];
  const placeId = d.placeId || placeIdFromCid(d.cid);
  const city = d.city || cityOf(String(r[5] || ''), String(r[7] || ''));
  const ta = d.tripadvisorName || d.place || String(r[1] || '');
  let kept = 0;
  for (const v of d.reviews) {
    if (!inRange(v)) continue;
    const key = `${placeId}|${v.id}`; // same Google place collected twice must not duplicate reviews
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ place_id: placeId, city, tripadvisor_name: ta, google_name: d.googlePlace && d.googlePlace !== 'Results' ? d.googlePlace : String(r[8] || ta), author: v.author, rating: v.rating, date: v.date, text: v.text });
    kept++;
  }
  console.log(`row ${rowNo} ${ta}: listed ${d.listed ?? '?'}, loaded ${d.reviews.length}, kept ${kept}`);
}
const out = `output/google-reviews-final-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
await fs.writeFile(out, '﻿' + [FINAL_COLS.join(','), ...rows.map((r) => FINAL_COLS.map((c) => csvCell(r[c])).join(','))].join('\n'), 'utf8');
console.log(`${rows.length} reviews from ${files.length} places -> ${out}`);
