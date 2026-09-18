/* שקלול לאורך זמן של תשובות Jev (מסנן הסתברותי קדימה, בסגנון HMM):
   בכל קטע — אמונה על 55 הפרקים. חיזוי: נשארים בפרק, או עוברים לבא אחריו, בהסתברות
   שתלויה באורך הפרק; דילוג וחזרה אפשריים אך נדירים. עדכון: ההסתברויות של Jev לקטע.
   "לא סליחות" בביטחון — לא מעדכנים (הדף עוצר).

   מודד מול המנגנון הקיים על הקטעים שהוא זיהה, כשפרקים זהים בטקסט (אל מלך יושב ×4,
   ויעבור ×2, קדיש ×3, רחום וחנון ×2) נחשבים אותו פרק.

   שימוש: node research/jev_filter.mjs [full|blind] [kotel,k0913,k0909]
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Aligner, tokenize } from '../server/matcher.js';
import { Tracker } from '../server/tracker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2] || 'full';
const NIGHTS = (process.argv[3] || 'kotel,k0913,k0909').split(',');
const O = { wps: 1.4, seg: 12, jumpEps: 0.002, skipDecay: 0.35, noneHold: 0.6, gamma: 1, floor: 0.01,
  ...(process.env.FILTER_OPTS ? JSON.parse(process.env.FILTER_OPTS) : {}) };

const doc = JSON.parse(fs.readFileSync(path.join(root, 'data/slichot.json'), 'utf8'));
const words = JSON.parse(fs.readFileSync(path.join(root, 'data/index_words.json'), 'utf8'));
const cache = JSON.parse(fs.readFileSync(path.join(root, `research/kotel-transcripts/jev-${MODE}.json`), 'utf8'));
const plain = t => t.replace(/[֑-ׇ]/g, '').replace(/[^א-ת ]/g, ' ').replace(/\s+/g, ' ').trim();

const secs = doc.sections.map(s => {
  let from = Infinity, to = -1; const ws = [];
  for (const p of s.paragraphs) for (const w of p.w) { from = Math.min(from, w.i); to = Math.max(to, w.i); ws.push(plain(w.t)); }
  return { title: plain(s.title), from, to, len: ws.length, key: ws.filter(Boolean).slice(0, 5).join(' ') };
});
const N = secs.length;
// פרקים זהים בטקסט = אותה קבוצה
const group = secs.map((s, i) => /קדיש/.test(s.title) ? 'kaddish' : s.key);
const same = (a, b) => a === b || group[a] === group[b];
const secOf = i => secs.findIndex(s => i >= s.from && i <= s.to);

// מעבר: הסתברות לעזוב פרק בקטע אחד ≈ מילים בקטע / אורך הפרק
function transition(b) {
  const out = new Float64Array(N);
  const perSeg = O.wps * O.seg;
  for (let i = 0; i < N; i++) {
    if (!b[i]) continue;
    const leave = Math.min(0.6, Math.max(0.03, perSeg / secs[i].len));
    out[i] += b[i] * (1 - leave - O.jumpEps);
    // עזיבה: בעיקר לפרק הבא, בדעיכה לדילוגים קדימה
    let norm = 0; const w = [];
    for (let k = 1; k <= 6 && i + k < N; k++) { w.push(O.skipDecay ** (k - 1)); norm += O.skipDecay ** (k - 1); }
    w.forEach((x, k) => { out[i + k + 1] += b[i] * leave * x / norm; });
    // קפיצה לכל מקום (חזרה על פרק, דילוג גדול)
    for (let j = 0; j < N; j++) out[j] += b[i] * O.jumpEps / N;
  }
  return normalize(out);
}
function normalize(v) { const s = v.reduce((a, b) => a + b, 0) || 1; return v.map(x => x / s); }

const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const totals = { lab: 0, raw: 0, filt: 0, cov: 0, segs: 0, trk: 0 };

for (const name of NIGHTS) {
  const trans = JSON.parse(fs.readFileSync(path.join(root, `research/kotel-transcripts/${name}.m4a.stt-12s.json`), 'utf8'));
  const times = Object.keys(trans).map(Number).sort((a, b) => a - b);
  const tracker = new Tracker(new Aligner(words));
  let b = normalize(new Float64Array(N).fill(1));
  let started = false;
  let lab = 0, raw = 0, filt = 0, cov = 0, trk = 0;
  const trace = [];
  for (const at of times) {
    const text = (trans[at] || '').trim();
    const r = tracker.update(tokenize(text), at * 1000);
    const truth = r ? secOf(r.word) : -1;
    if (truth >= 0) trk++;
    const a = cache[`${name}:${at}:`];
    let jevTop = -1, none = false;
    if (a) {
      const pNone = a.p?.none ?? 0;
      none = pNone >= O.noneHold;
      jevTop = a.choice === 'none' ? -1 : Number(a.choice.slice(1));
      if (!none) {
        const pred = started ? transition(b) : b;
        const post = new Float64Array(N);
        for (let j = 0; j < N; j++) post[j] = pred[j] * ((a.p?.['s' + j] ?? 0) + O.floor) ** O.gamma;
        b = normalize(post);
        started = true;
      }
    }
    let best = 0; for (let j = 1; j < N; j++) if (b[j] > b[best]) best = j;
    const shown = started && !none && b[best] >= 0.5 ? best : -1;
    if (shown >= 0) cov++;
    if (truth >= 0) {
      lab++;
      if (jevTop >= 0 && same(jevTop, truth)) raw++;
      if (shown >= 0 && same(shown, truth)) filt++;
    }
    trace.push({ t: mmss(at), truth: truth >= 0 ? secs[truth].title : '', jev: none ? 'none' : jevTop >= 0 ? secs[jevTop].title : '', filt: shown >= 0 ? secs[shown].title : '', p: +b[best].toFixed(2) });
  }
  console.log(`${name}: ${times.length} קטעים · המנגנון הקיים זיהה ${trk} (${pct(trk, times.length)}) · המסנן מציג פרק ב-${cov} (${pct(cov, times.length)})`);
  console.log(`  על הקטעים שהמנגנון זיהה (${lab}): Jev גולמי ${pct(raw, lab)} · Jev + מסנן ${pct(filt, lab)}`);
  fs.writeFileSync(path.join(root, `research/kotel-transcripts/jev-filter-${MODE}-${name}.json`), JSON.stringify(trace, null, 0).replace(/},{/g, '},\n{'));
  Object.assign(totals, { lab: totals.lab + lab, raw: totals.raw + raw, filt: totals.filt + filt, cov: totals.cov + cov, segs: totals.segs + times.length, trk: totals.trk + trk });
}
console.log(`\nסה״כ: גולמי ${pct(totals.raw, totals.lab)} · מסנן ${pct(totals.filt, totals.lab)} · כיסוי מסנן ${pct(totals.cov, totals.segs)} מול מנגנון קיים ${pct(totals.trk, totals.segs)}`);
