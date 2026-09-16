/* ניסוי מעקב על הקלטה: מריץ הקלטת סליחות דרך אותו צינור בדיוק כמו השידור החי
   (חיתוך -> תמלול -> התאמה) ומדפיס את מסלול הזיהוי, כדי לבדוק אם המעקב עובד.

   שימוש:
     node scripts/test_kotel.mjs <קובץ-אודיו|כתובת-יוטיוב> [--seconds 180] [--start 0] [--seg 8]
*/
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Aligner, tokenize } from '../server/matcher.js';
import { transcribe, kotelConfig, resolveFfmpeg } from '../server/kotel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const src = args.find(a => !a.startsWith('--'));
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const SECONDS = flag('seconds', 180);
// --drive <כתובת>: מזין את המיקומים לשרת חי, כדי לראות את הדף עוקב בפועל
const driveAt = args.indexOf('--drive');
const DRIVE = driveAt >= 0 ? args[driveAt + 1] : '';
const tokenAt = args.indexOf('--token');
const TOKEN = tokenAt >= 0 ? args[tokenAt + 1] : (process.env.ADMIN_TOKEN || '');
// --realtime: משהה בין קטעים כמו בשידור אמיתי, במקום לרוץ במלוא המהירות
const REALTIME = args.includes('--realtime');
const START = flag('start', 0);
const SEG = flag('seg', kotelConfig.segSec || 8);

if (!src) {
  console.error('שימוש: node scripts/test_kotel.mjs <קובץ|כתובת> [--seconds 180] [--start 0]');
  process.exit(1);
}

const doc = JSON.parse(fs.readFileSync(path.join(root, 'data/slichot.json'), 'utf8'));
const words = JSON.parse(fs.readFileSync(path.join(root, 'data/index_words.json'), 'utf8'));
const aligner = new Aligner(words);

// מיפוי אינדקס מילה -> שם פרק
const secMap = doc.sections.map(s => {
  let from = Infinity, to = -1;
  for (const p of s.paragraphs) for (const w of p.w) { if (w.i < from) from = w.i; if (w.i > to) to = w.i; }
  return { from, to, title: s.title };
});
const sectionFor = i => (secMap.find(s => i >= s.from && i <= s.to) || {}).title || '—';
const textAt = (i, n = 6) => {
  const out = [];
  for (const s of doc.sections) for (const p of s.paragraphs) for (const w of p.w) {
    if (w.i >= i - n && w.i <= i) out.push(w.t);
  }
  return out.join(' ');
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kotel-test-'));
const ffmpeg = await resolveFfmpeg();

/* ---------- 1. השגת אודיו ---------- */
let audio = src;
if (/^https?:/.test(src)) {
  audio = path.join(tmp, 'src.m4a');
  console.log('מוריד אודיו מהכתובת…');
  const r = spawnSync('yt-dlp', ['-q', '--no-warnings', '-f', 'bestaudio[ext=m4a]/bestaudio',
    '--download-sections', `*${START}-${START + SECONDS}`, '-o', audio, src], { stdio: 'inherit' });
  if (r.status !== 0 || !fs.existsSync(audio)) { console.error('ההורדה נכשלה'); process.exit(1); }
}

/* ---------- 2. חיתוך לקטעים, בדיוק כמו בשידור החי ---------- */
console.log(`חותך לקטעים של ${SEG} שניות…`);
const segArgs = ['-hide_banner', '-loglevel', 'error'];
if (!/^https?:/.test(src) && START) segArgs.push('-ss', String(START));
segArgs.push('-i', audio);
if (!/^https?:/.test(src)) segArgs.push('-t', String(SECONDS));
segArgs.push('-vn', '-ac', '1', '-ar', '16000', '-f', 'segment',
  '-segment_time', String(SEG), '-reset_timestamps', '1', path.join(tmp, 'seg%05d.wav'));
const cut = spawnSync(ffmpeg, segArgs, { stdio: 'inherit' });
if (cut.status !== 0) { console.error('חיתוך האודיו נכשל'); process.exit(1); }

const segs = fs.readdirSync(tmp).filter(f => f.startsWith('seg') && f.endsWith('.wav')).sort();
console.log(`נוצרו ${segs.length} קטעים. מתמלל עם ${kotelConfig.provider}…\n`);

/* ---------- 3. תמלול + התאמה, בדיוק כמו במנוע החי ---------- */
// מטמון תמלולים: כיול מנוע ההתאמה לא אמור לעלות כסף על כל ריצה
const cacheFile = (/^https?:/.test(src) ? path.join(root, 'data/.transcripts-' + Buffer.from(src).toString('base64url').slice(0, 24)) : audio) + `.stt-${SEG}s.json`;
let cache = {};
try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
let cacheHits = 0, apiCalls = 0;
let tail = [], hint = -1, prev = -1, prevAt = -1;
const rows = [];
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

for (let i = 0; i < segs.length; i++) {
  const file = path.join(tmp, segs[i]);
  const at = START + i * SEG;
  let text = '';
  if (cache[at] !== undefined) { text = cache[at]; cacheHits++; }
  else {
    try {
      const buf = fs.readFileSync(file);
      if (buf.length < 20000) { rows.push({ at, text: '(שקט)', word: null }); continue; }
      text = await transcribe(buf);
      apiCalls++;
      cache[at] = text;
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    } catch (e) {
      console.error(`  [${mmss(at)}] תמלול נכשל: ${e.message}`);
      continue;
    }
  }
  const toks = tokenize(text);
  tail = tail.concat(toks).slice(-40);
  const r = toks.length ? aligner.locate(tail, hint) : null;

  let accepted = false;
  if (r) {
    const jump = hint >= 0 ? Math.abs(r.word - hint) : 0;
    const minConf = jump > 250 ? Math.max(0.45, kotelConfig.minConfidence) : kotelConfig.minConfidence;
    if (r.confidence >= minConf) { accepted = true; hint = r.word; }
  }
  // ההתקדמות נמדדת מול הזמן שחלף מאז הזיהוי הקודם, לא מול מספר הקטעים שזוהו
  const advance = accepted && prev >= 0 ? r.word - prev : null;
  const elapsedSeg = accepted && prevAt >= 0 ? (at - prevAt) / SEG : 1;
  const plausible = advance === null || (advance >= -4 && advance <= 40 * Math.max(1, elapsedSeg));
  if (accepted) { prev = r.word; prevAt = at; }

  rows.push({ at, text, word: accepted ? r.word : null, conf: r?.confidence ?? 0, advance, plausible });

  if (DRIVE && accepted) {
    try {
      await fetch(DRIVE.replace(/\/$/, '') + '/api/live/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
        body: JSON.stringify({ word: r.word })
      });
    } catch (e) { console.warn('         ↳ הזנה לשרת נכשלה:', e.message); }
  }
  if (REALTIME && i < segs.length - 1) await new Promise(r2 => setTimeout(r2, SEG * 1000));
  console.log(`[${mmss(at)}] תמלול: ${text.slice(0, 90)}`);
  if (accepted) {
    console.log(`         ↳ מילה ${r.word} · ${sectionFor(r.word)} · ודאות ${r.confidence}` +
      (advance !== null ? ` · התקדמות ${advance > 0 ? '+' : ''}${advance} מילים` : ''));
    console.log(`         ↳ בטקסט: …${textAt(r.word)}`);
  } else {
    console.log(`         ↳ לא זוהה מיקום${r ? ` (ודאות ${r.confidence} מתחת לסף)` : ''}`);
  }
}

/* ---------- 4. סיכום ---------- */
const hits = rows.filter(r => r.word !== null);
const moves = hits.filter(r => r.advance !== null);
const forward = moves.filter(r => r.plausible).length;
const jumps = moves.filter(r => !r.plausible);
console.log('\n' + '─'.repeat(60));
console.log(`קטעים: ${rows.length} · זוהה מיקום ב-${hits.length}` + (rows.length ? ` (${Math.round(hits.length / rows.length * 100)}%)` : ''));
console.log(`התקדמות סבירה לפי הזמן שחלף: ${forward}/${Math.max(1, moves.length)} מהמעברים`);
if (!hits.length) console.log('לא זוהה אף מיקום — בדקו את מפתח התמלול ואת איכות האודיו.');
if (jumps.length) console.log(`קפיצות חשודות: ${jumps.length} — ${jumps.map(j => mmss(j.at)).join(', ')}`);
const avgConf = hits.length ? (hits.reduce((s, r) => s + r.conf, 0) / hits.length).toFixed(2) : 0;
console.log(`ודאות ממוצעת: ${avgConf}`);
console.log(`תמלול: ${apiCalls} קריאות API, ${cacheHits} מהמטמון`);
console.log(`פרקים שזוהו לפי הסדר: ${[...new Set(hits.map(h => sectionFor(h.word)))].join(' → ')}`);

fs.rmSync(tmp, { recursive: true, force: true });
