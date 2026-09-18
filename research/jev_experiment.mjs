/* ניסוי: האם Jev (TypeSafe) מזהה באיזה פרק החזן נמצא, מתוך תמלולי 12 שניות מהכותל?
   משווה לזיהוי של המנגנון הקיים (Aligner + Tracker) על אותם תמלולים שמורים — בלי תמלול חדש.

   שני מצבים:
     blind — כל 55 הפרקים כאפשרויות, בלי ידע על המיקום הקודם
     full  — כמו blind, אבל עם הטקסט המלא של כל פרק (לא רק 60 המילים הראשונות)
     seq   — מסנן רציף: הפרק הקודם ש-Jev עצמו זיהה ו-8 שאחריו, ואפשרות "לא טקסט הסליחות"

   שימוש: node --env-file=.env research/jev_experiment.mjs [blind|seq] [kotel,k0913,k0909]
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Aligner, tokenize } from '../server/matcher.js';
import { Tracker } from '../server/tracker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2] || 'seq';
const NIGHTS = (process.argv[3] || 'kotel,k0913,k0909').split(',');
const KEY = process.env.TYPESAFE_API_KEY;
const SEG = 12;
if (!KEY) { console.error('חסר TYPESAFE_API_KEY'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(path.join(root, 'data/slichot.json'), 'utf8'));
const words = JSON.parse(fs.readFileSync(path.join(root, 'data/index_words.json'), 'utf8'));
const plain = t => t.replace(/[֑-ׇ]/g, '').replace(/[^א-ת ]/g, ' ').replace(/\s+/g, ' ').trim();

const sections = doc.sections.map((s, n) => {
  let from = Infinity, to = -1;
  const ws = [];
  for (const p of s.paragraphs) for (const w of p.w) {
    if (w.i < from) from = w.i;
    if (w.i > to) to = w.i;
    ws.push(plain(w.t));
  }
  return { n, id: 's' + n, title: plain(s.title), from, to, text: ws.filter(Boolean).join(' ') };
});
const secOf = i => sections.find(s => i >= s.from && i <= s.to);
const NONE = 'none';
const NONE_TEXT = 'לא טקסט הסליחות: דרשה, הכרזה, מי שברך, ברכות, ניגון בלי מילים, רעש או שקט';

const criterion = (s, maxWords) => `${s.title}: ${s.text.split(' ').slice(0, maxWords).join(' ')}`;

/* ---------- מטמון תשובות ---------- */
const cacheFile = path.join(root, `research/kotel-transcripts/jev-${MODE}.json`);
let cache = {};
try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
const save = () => fs.writeFileSync(cacheFile, JSON.stringify(cache));
let tokensUsed = 0;

async function ask(cacheKey, body) {
  if (cache[cacheKey]) return cache[cacheKey];
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', ...body }),
      signal: AbortSignal.timeout(30000)
    });
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 2000 * (attempt + 1))); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
    tokensUsed += j.usage?.input_tokens || 0;
    const a = j.answers.where;
    cache[cacheKey] = { choice: a.choice, confidence: a.confidence, p: a.probabilities, ms: 0 };
    return cache[cacheKey];
  }
  throw new Error('נכשל אחרי 4 ניסיונות');
}

const INSTR = 'לפניך תמלול אוטומטי (עם שגיאות) של השניות האחרונות מתוך שידור סליחות בנוסח עדות המזרח מהכותל. ' +
  'השורה האחרונה היא הרגע הנוכחי. באיזה פרק של הסליחות החזן והקהל נמצאים עכשיו? ' +
  'כל אפשרות היא פרק עם הטקסט שלו. אם ברגע הנוכחי לא נאמר טקסט מהסליחות — בחר באפשרות "none".';

/* ---------- ריצה על ערב אחד ---------- */
async function runNight(name) {
  const trans = JSON.parse(fs.readFileSync(path.join(root, `research/kotel-transcripts/${name}.m4a.stt-12s.json`), 'utf8'));
  const times = Object.keys(trans).map(Number).sort((a, b) => a - b);
  const aligner = new Aligner(words);
  const tracker = new Tracker(aligner);
  const rows = [];
  let prevSec = -1;   // seq: הפרק האחרון ש-Jev זיהה בביטחון

  // blind: כל הקריאות במקביל (בקבוצות)
  const pending = [];
  for (let k = 0; k < times.length; k++) {
    const at = times[k];
    const text = (trans[at] || '').trim();
    const r = tracker.update(tokenize(text), at * 1000);
    const truth = r ? secOf(r.word)?.n ?? null : null;
    const row = { at, text, truth, kind: r?.kind };
    rows.push(row);
    if (tokenize(text).length < 3) continue;   // קטע כמעט ריק — אין מה לשאול

    const recent = times.slice(Math.max(0, k - 2), k + 1).map(t => (trans[t] || '').trim()).filter(Boolean);
    const state = { 'תמלול (מהישן לחדש)': recent };

    let cands;
    if (MODE === 'blind' || MODE === 'full' || prevSec < 0) cands = sections;
    else cands = sections.slice(prevSec, prevSec + 9);
    const maxWords = MODE === 'full' ? Infinity : cands.length > 20 ? 60 : 400;
    const criteria = { [NONE]: NONE_TEXT };
    for (const s of cands) criteria[s.id] = criterion(s, maxWords);
    if (MODE === 'seq' && prevSec >= 0) state['הפרק האחרון שזוהה'] = sections[prevSec].title;

    const key = `${name}:${at}:${MODE === 'seq' ? prevSec : ''}`;
    const job = ask(key, { state, questions: { where: { type: 'choice', instructions: INSTR, criteria } } })
      .then(a => { row.jev = a.choice === NONE ? NONE : Number(a.choice.slice(1)); row.conf = a.confidence; })
      .catch(e => { row.err = e.message; });

    if (MODE === 'seq') {
      await job;
      if (row.jev !== undefined && row.jev !== NONE && row.conf >= 0.5) prevSec = row.jev;
      if (k % 25 === 0) { save(); process.stdout.write(`\r${name} ${k}/${times.length}`); }
    } else {
      pending.push(job);
      if (pending.length >= 12) { await Promise.all(pending.splice(0)); save(); process.stdout.write(`\r${name} ${k}/${times.length}`); }
    }
  }
  await Promise.all(pending);
  save();
  process.stdout.write('\n');
  return rows;
}

/* ---------- סיכום ---------- */
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const all = {};
for (const n of NIGHTS) all[n] = await runNight(n);

console.log(`\n=== Jev · מצב ${MODE} · ${tokensUsed.toLocaleString()} טוקנים חדשים ===`);
for (const [n, rows] of Object.entries(all)) {
  const asked = rows.filter(r => r.jev !== undefined);
  const labeled = asked.filter(r => r.truth !== null);
  const agree = labeled.filter(r => r.jev === r.truth);
  const near = labeled.filter(r => r.jev !== NONE && Math.abs(r.jev - r.truth) <= 1);
  const saidNone = labeled.filter(r => r.jev === NONE);
  const unl = asked.filter(r => r.truth === null);
  const unlNone = unl.filter(r => r.jev === NONE);
  const confAgree = labeled.filter(r => r.conf >= 0.8);
  console.log(`\n${n}: נשאלו ${asked.length} קטעים, מתוכם ${labeled.length} שהמנגנון הקיים זיהה`);
  console.log(`  התאמה לפרק של המנגנון הקיים: ${agree.length}/${labeled.length} (${pct(agree.length, labeled.length)}) · עד פרק אחד הפרש: ${pct(near.length, labeled.length)}`);
  console.log(`  כשהביטחון ≥0.8: ${confAgree.filter(r => r.jev === r.truth).length}/${confAgree.length} (${pct(confAgree.filter(r => r.jev === r.truth).length, confAgree.length)})`);
  console.log(`  אמר "לא סליחות" על קטע שזוהה: ${saidNone.length}`);
  console.log(`  קטעים שהמנגנון לא זיהה: ${unl.length} — Jev אמר "לא סליחות" ב-${unlNone.length}, ובשאר נתן פרק`);
  if (rows.some(r => r.err)) console.log(`  שגיאות: ${rows.filter(r => r.err).length} — ${rows.find(r => r.err).err}`);
}
function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '—'; }

// פירוט לבדיקה ידנית
const out = path.join(root, `research/kotel-transcripts/jev-${MODE}-rows.json`);
fs.writeFileSync(out, JSON.stringify(Object.fromEntries(Object.entries(all).map(([n, rows]) => [n, rows.map(r => ({
  t: mmss(r.at), text: r.text.slice(0, 80), truth: r.truth === null ? null : sections[r.truth].title,
  jev: r.jev === undefined ? undefined : r.jev === NONE ? NONE : sections[r.jev].title, conf: r.conf
}))])), null, 1));
console.log('\nפירוט: ' + path.relative(root, out));
