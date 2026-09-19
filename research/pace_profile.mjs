/* פרופיל קצב לפי פרק, מתוך התמלולים השמורים (בלי עלות תמלול).
   1. מריץ את המנגנון הקיים (Aligner + Tracker) על כל ערב ומקבל רצף זיהויים (זמן, מילה).
   2. לכל פרק: קצב אמירה (מילים לשנייה) בין זיהויים עוקבים באותו פרק.
   3. בודק את ההתקדמות המשוערת שבין זיהוי לזיהוי: השיטה הקיימת (קצב 8 הזיהויים האחרונים)
      מול קצב הפרק מערבים *אחרים* (leave-one-out — הערב הנבדק אינו בפרופיל שלו).
   מדדים: שגיאה ממוצעת במילים, "נסיגות" (הדף הקדים והזיהוי החזיר אותו אחורה > 5 מילים),
   ו"קפיצות קדימה" (הדף פיגר והזיהוי הקפיץ אותו > 30 מילים).
   שימוש: node research/pace_profile.mjs [--write]   (‎--write שומר data/pace_profile.json) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Aligner, tokenize } from '../server/matcher.js';
import { Tracker } from '../server/tracker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'research/kotel-transcripts');
const words = JSON.parse(fs.readFileSync(path.join(root, 'data/index_words.json'), 'utf8'));
const doc = JSON.parse(fs.readFileSync(path.join(root, 'data/slichot.json'), 'utf8'));

const secOf = new Map();
for (const s of doc.sections) for (const p of s.paragraphs) for (const w of p.w) secOf.set(w.i, s.slug);
const title = Object.fromEntries(doc.sections.map(s => [s.slug, s.title]));

// הקבצים בלי סיומת מודל = scribe_v1 בלי הטיה (ראו sources.json)
const files = fs.readdirSync(dir).filter(f => /\.stt-12s\.json$/.test(f)).sort();
const runs = {};
for (const f of files) {
  const name = f.split('.')[0];
  const tr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const tracker = new Tracker(new Aligner(words));
  const hits = [];
  for (const t of Object.keys(tr).map(Number).sort((a, b) => a - b)) {
    // הקטע מסתיים ב-t+12 — אז הוא זמין למנוע
    const r = tracker.update(tokenize(tr[t]), (t + 12) * 1000);
    if (r) hits.push({ t: t + 12, w: r.word, sec: secOf.get(r.word) });
  }
  runs[name] = hits;
}

// קצב בין זיהויים עוקבים באותו פרק
function rates(names) {
  const by = {};
  for (const n of names) {
    const h = runs[n];
    for (let i = 1; i < h.length; i++) {
      const a = h[i - 1], b = h[i], dt = b.t - a.t, dw = b.w - a.w;
      if (a.sec !== b.sec || dt <= 0 || dt > 60 || dw < 0 || dw > 250) continue;
      (by[a.sec] ||= []).push(dw / dt);
    }
  }
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const out = {};
  for (const [k, v] of Object.entries(by)) if (v.length >= 3) out[k] = { rate: +med(v).toFixed(2), n: v.length };
  return out;
}

// הדמיית ההתקדמות המשוערת (כמו KotelEngine._tick): מתחילה 6 שנ׳ אחרי זיהוי, תקרה 30 מילים
const DRIFT_START = 6, CAP = 30;
function simulate(hits, rateFn) {
  let err = 0, n = 0, back = 0, fwd = 0;
  for (let i = 1; i < hits.length; i++) {
    const a = hits[i - 1], b = hits[i], dt = b.t - a.t;
    if (dt > 90 || b.w < a.w - 6) continue;   // קפיצות/הפסקות — לא מדד להתקדמות משוערת
    const perSec = rateFn(hits, i - 1);
    const pred = a.w + Math.min(CAP, Math.max(0, Math.round(perSec * (dt - DRIFT_START))));
    const e = b.w - pred;
    err += Math.abs(e); n++;
    if (e < -5) back++;
    if (e > 30) fwd++;
  }
  return { n, mae: +(err / n).toFixed(1), back, fwd };
}
// השיטה הקיימת: קצב 8 הזיהויים האחרונים (observedWpm), ברירת מחדל 95 מילים לדקה
const current = (hits, i) => {
  const p = hits.slice(Math.max(0, i - 7), i + 1);
  if (p.length < 3) return 95 / 60;
  const wpm = (p.at(-1).w - p[0].w) / ((p.at(-1).t - p[0].t) / 60);
  return (wpm > 0 ? Math.max(20, Math.min(200, wpm)) : 95) / 60;
};

const names = Object.keys(runs);
console.log('ערב      | זיהויים | שיטה קיימת: שגיאה/נסיגות/קפיצות | קצב לפי פרק: שגיאה/נסיגות/קפיצות');
const tot = { c: { mae: 0, back: 0, fwd: 0, n: 0 }, p: { mae: 0, back: 0, fwd: 0, n: 0 } };
for (const n of names) {
  const prof = rates(names.filter(x => x !== n));   // בלי הערב הנבדק
  const byProfile = (hits, i) => prof[hits[i].sec]?.rate ?? current(hits, i);
  const c = simulate(runs[n], current), p = simulate(runs[n], byProfile);
  console.log(`${n.padEnd(8)} | ${String(runs[n].length).padStart(7)} | ${String(c.mae).padStart(6)} / ${String(c.back).padStart(3)} / ${String(c.fwd).padStart(3)}${' '.repeat(16)}| ${String(p.mae).padStart(6)} / ${String(p.back).padStart(3)} / ${String(p.fwd).padStart(3)}`);
  for (const [k, v] of [['c', c], ['p', p]]) { tot[k].mae += v.mae * v.n; tot[k].n += v.n; tot[k].back += v.back; tot[k].fwd += v.fwd; }
}
for (const k of ['c', 'p']) tot[k].mae = +(tot[k].mae / tot[k].n).toFixed(1);
console.log(`סה״כ (${tot.c.n} מעברים): קיימת ${tot.c.mae} מילים, ${tot.c.back} נסיגות, ${tot.c.fwd} קפיצות · לפי פרק ${tot.p.mae} מילים, ${tot.p.back} נסיגות, ${tot.p.fwd} קפיצות`);

const all = rates(names);
console.log('\nקצב לפי פרק (כל הערבים, מילים לשנייה):');
for (const s of doc.sections) if (all[s.slug]) console.log(`  ${all[s.slug].rate.toFixed(2).padStart(5)}  (${String(all[s.slug].n).padStart(3)} מדידות)  ${title[s.slug]}`);
if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(root, 'data/pace_profile.json'), JSON.stringify({ source: names, unit: 'words/sec', sections: all }, null, 1));
  console.log('\nנשמר data/pace_profile.json');
}
