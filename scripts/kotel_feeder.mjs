/* מזין מרוחק למעקב הכותל.
   יוטיוב חוסמת את כתובות ה-IP של Render, ולכן הקליטה והתמלול רצים על מכונה שאינה
   חסומה, ולאתר החי נשלחים רק מיקומים. זה אותו מנוע בדיוק (server/kotel.js).

   הקליטה פועלת רק כשיש באתר מאזינים, כמו בשרת עצמו — אחרת התמלול עולה כסף לחינם.
   המקור: קישור שהוזן בלוח הבקרה (/admin) אם יש; אחרת שידור סליחות חי בערוץ הכותל;
   אחרת מצלמת הרחבה.

   שימוש:
     FEED_TARGET=https://slichot.onrender.com ADMIN_TOKEN=… \
     STT_PROVIDER=elevenlabs ELEVENLABS_API_KEY=… \
     node scripts/kotel_feeder.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KotelEngine } from '../server/kotel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = (process.env.FEED_TARGET || 'https://slichot.onrender.com').replace(/\/$/, '');
const TOKEN = process.env.ADMIN_TOKEN || '';
const BEAT_MS = 10000;

if (!TOKEN) {
  console.error('חסר ADMIN_TOKEN');
  process.exit(1);
}

// כל שורת יומן נשלחת גם לאתר (בפעימה הבאה) — נראית בלוח הבקרה, "יומן מעקב חי"
const outbox = [];
const log = (...a) => {
  console.log(new Date().toISOString().slice(11, 19), ...a);
  outbox.push({ at: Date.now(), msg: a.join(' ').slice(0, 400) });
  if (outbox.length > 300) outbox.shift();
};
const sec = ms => (ms / 1000).toFixed(1);
const KINDS = { step: 'התקדמות', jump: 'דילוג מאושר', local: 'סריקה מקומית' };

async function post(body) {
  const logs = outbox.splice(0);
  const r = await fetch(TARGET + '/api/live/remote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
    body: JSON.stringify({ ...body, logs }),
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const doc = JSON.parse(fs.readFileSync(path.join(root, 'data/slichot.json'), 'utf8'));
const words = JSON.parse(fs.readFileSync(path.join(root, 'data/index_words.json'), 'utf8'));
let lastSeg = null;
const engine = new KotelEngine(doc, words, {
  onPosition: (word, confidence) => {
    const seg = lastSeg, t = Date.now();
    post({ word, confidence, segReadyAt: seg?.readyAt || 0 })
      .then(() => {
        const now = Date.now();
        // עיכוב מרגע שהקול הגיע מיוטיוב עד שהמיקום באתר: המילה האחרונה בקטע / הראשונה (+אורך הקטע)
        const lag = seg ? now - seg.readyAt : 0;
        log(`מיקום ${word} (${engine.sectionFor(word)}) ודאות ${confidence.toFixed(2)} · נשלח לאתר ב-${now - t}ms`
          + (seg ? ` · עיכוב מסוף הקטע ${sec(lag)} שנ׳, מתחילתו ${sec(lag + SEG_MS)} שנ׳` : ''));
      })
      .catch(e => log('שליחת מיקום נכשלה:', e.message));
  },
  onSegment: seg => {
    lastSeg = seg;
    if (seg.skip) return log(`קטע ${seg.file}: דולג (${seg.skip})`);
    if (seg.error) return log(`קטע ${seg.file}: התמלול נכשל אחרי ${sec(seg.sttMs)} שנ׳ — ${seg.error}`);
    const r = seg.result;
    log(`קטע ${seg.file}: תמלול ${sec(seg.sttMs)} שנ׳, ${seg.words} מילים → `
      + (r ? `${KINDS[r.kind] || r.kind} למילה ${r.word} (${r.section})` : 'לא זוהה')
      + ` | "${seg.text}"`);
  }
});
const SEG_MS = Number(process.env.KOTEL_SEGMENT_SEC || 12) * 1000;

// עיכוב השידור ביוטיוב: לפי חותמת הזמן (EXT-X-PROGRAM-DATE-TIME) של המקטע האחרון בפלייליסט
async function youtubeDelay() {
  if (engine.state.mode !== 'listening' || !engine.mediaLive || !/m3u8/.test(engine.mediaUrl || '')) return;
  try {
    let txt = await (await fetch(engine.mediaUrl, { signal: AbortSignal.timeout(10000) })).text();
    if (txt.includes('#EXT-X-STREAM-INF')) {
      const variant = txt.split('\n').find(l => l && !l.startsWith('#'));
      txt = await (await fetch(new URL(variant, engine.mediaUrl), { signal: AbortSignal.timeout(10000) })).text();
    }
    const lines = txt.split('\n');
    let last = 0, dur = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-PROGRAM-DATE-TIME:')) last = Date.parse(lines[i].slice(25));
      else if (lines[i].startsWith('#EXTINF:') && last) dur = parseFloat(lines[i].slice(8)) * 1000;
    }
    if (last) log(`עיכוב השידור ביוטיוב (מהמצלמה עד שהקול זמין לנו): ~${sec(Date.now() - (last + dur))} שנ׳`);
  } catch (e) { log('מדידת עיכוב יוטיוב נכשלה:', e.message); }
}
setInterval(youtubeDelay, 60000);

// "מאזין" מקומי מדומה: המנוע קולט רק כשיש לו לקוחות, ואנחנו מחזיקים אחד
// בדיוק כל עוד יש מאזינים באתר החי
const proxy = { write() {}, on() {} };
let wasListening = false;

async function beat() {
  const ingesting = engine.state.mode === 'listening';
  try {
    const { listeners, override = '' } = await post({
      ingesting, source: engine.sourceInfo(),
      // לא קולטים בכוונה (מחוץ לשעות הסליחות / אין שידור) — האתר יציג את הסיבה
      idle: !ingesting && engine.state.mode === 'off' && engine.clients.size ? engine._idleMessage() : ''
    });
    // קישור מלוח הבקרה (או ניקויו — חזרה לערוץ הכותל)
    if (override !== engine.override) {
      try {
        engine.setSource(override);
        log(override ? `מקור מלוח הבקרה: ${override}` : 'הקישור נוקה — חוזר לערוץ הכותל');
      } catch (e) { log('קישור לא תקין מלוח הבקרה:', e.message); }
    }
    if (listeners > 0 && !engine.clients.has(proxy)) {
      log(`${listeners} מאזינים באתר — מתחיל לקלוט`);
      engine.addClient(proxy);
    } else if (!listeners && engine.clients.has(proxy)) {
      log('אין מאזינים — הקליטה תיעצר בעוד כמה דקות');
      engine.clients.delete(proxy);
    }
  } catch (e) {
    log('האתר החי לא ענה:', e.message);
  }
  if (ingesting !== wasListening) {
    log(ingesting ? 'קולט ומתמלל' : `לא קולט (${engine.state.mode})`);
    wasListening = ingesting;
  }
  if (engine.lastError && engine.lastError !== beat.lastError) {
    beat.lastError = engine.lastError;
    log('שגיאה:', engine.lastError.message);
  }
}

log(`מזין פעיל → ${TARGET}`);
beat();
setInterval(beat, BEAT_MS);
