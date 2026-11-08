import { relativeRange } from '../mapsCrawler.js';

const CITIES = [['Hoi_An', 'Hoi An'], ['Phu_Quoc', 'Phu Quoc'], ['Ho_Chi_Minh', 'Ho Chi Minh City'], ['Da_Nang', 'Da Nang'], ['Hanoi', 'Hanoi']];
export const cityOf = (...texts) => {
  const t = texts.join(' ').replace(/(%20|\s|\+)+/g, '_');
  return CITIES.find(([k]) => t.includes(k) || t.toLowerCase().includes(k.toLowerCase().replace('_', '')))?.[1] || '';
};

// Google Place ID (ChIJ...) from the "0x<hex>:0x<hex>" feature id: protobuf 0a 12 09 <le64> 11 <le64>, base64url.
export function placeIdFromCid(cid) {
  if (!cid) return '';
  const [a, b] = cid.split(':').map((h) => BigInt(h));
  const le = (n) => Buffer.from(n.toString(16).padStart(16, '0'), 'hex').reverse();
  return Buffer.concat([Buffer.from([0x0a, 0x12, 0x09]), le(a), Buffer.from([0x11]), le(b)]).toString('base64url');
}

export const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const FINAL_COLS = ['place_id', 'city', 'tripadvisor_name', 'google_name', 'author', 'rating', 'date', 'text'];


// Keep a review whenever its possible-date window overlaps [dateFrom, dateTo]; unparseable dates are kept.
export const makeInRange = (dateFrom, dateTo) => (r) => {
  const w = relativeRange(r.date);
  if (!w) return true;
  return w.oldest <= dateTo && w.newest >= dateFrom;
};
