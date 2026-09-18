/* מזין מרוחק למעקב הכותל.
   יוטיוב חוסמת את כתובות ה-IP של Render, ולכן הקליטה והתמלול רצים על מכונה שאינה
   חסומה, ולאתר החי נשלחים רק מיקומים. זה אותו מנוע בדיוק (server/kotel.js).

   הקליטה פועלת רק כשיש באתר מאזינים, כמו בשרת עצמו — אחרת התמלול עולה כסף לחינם.

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

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function post(body) {
  const r = await fetch(TARGET + '/api/live/remote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const doc = JSON.parse(fs.readFileSync(path.join(root, 'data/slichot.json'), 'utf8'));
const words = JSON.parse(fs.readFileSync(path.join(root, 'data/index_words.json'), 'utf8'));
const engine = new KotelEngine(doc, words, {
  onPosition: (word, confidence) => {
    log(`מיקום ${word} (${engine.sectionFor(word)}) ודאות ${confidence.toFixed(2)}`);
    post({ word, confidence }).catch(e => log('שליחת מיקום נכשלה:', e.message));
  }
});

// "מאזין" מקומי מדומה: המנוע קולט רק כשיש לו לקוחות, ואנחנו מחזיקים אחד
// בדיוק כל עוד יש מאזינים באתר החי
const proxy = { write() {}, on() {} };
let wasListening = false;

async function beat() {
  const ingesting = engine.state.mode === 'listening';
  try {
    const { listeners } = await post({ ingesting });
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
