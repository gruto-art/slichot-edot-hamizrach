/* מנוע "מעקב אחרי הכותל":
   שידור חי -> חיתוך לקטעי אודיו -> תמלול בזמן אמת -> התאמה לטקסט הסליחות -> שידור מיקום ללקוחות.
   פועל רק כשיש מאזינים, כדי לא לבזבז קריאות API. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Aligner, tokenize } from './matcher.js';

// ffmpeg: מעדיפים את הבינארי של המערכת (כך זה בייצור, בתוך ה-Docker);
// בפיתוח מקומי נופלים ל-ffmpeg-static אם הותקן.
export async function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {}
  try { return (await import('ffmpeg-static')).default; } catch {}
  return 'ffmpeg';
}

const CFG = {
  streamUrl: process.env.KOTEL_STREAM_URL || 'https://www.youtube.com/watch?v=LMHUcDktP-w',
  // 91 = 144p עם אודיו (~290kbps) — הזול ביותר לקליטה; נופל חזרה לאודיו בלבד אם קיים
  ytFormat: process.env.KOTEL_YTDLP_FORMAT || '91/bestaudio*/worst',
  // כתובת HLS ישירה נקלטת בלי yt-dlp כלל (חוסך את בדיקת הבוטים של יוטיוב)
  streamReferer: process.env.KOTEL_STREAM_REFERER || '',
  ytCookies: process.env.YTDLP_COOKIES || '',
  provider: (process.env.STT_PROVIDER || 'openai').toLowerCase(),
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
  elevenKey: process.env.ELEVENLABS_API_KEY || '',
  segSec: Number(process.env.KOTEL_SEGMENT_SEC || 8),
  idleStopMs: Number(process.env.KOTEL_IDLE_STOP_MS || 120000),
  minConfidence: Number(process.env.KOTEL_MIN_CONFIDENCE || 0.18),
  wpm: Number(process.env.KOTEL_WPM || 95)
};

// יוטיוב חוסמת כתובות IP של מרכזי נתונים ("Sign in to confirm you're not a bot").
// לקוחות נגן שונים נחסמים אחרת, ולכן מנסים כמה בזה אחר זה עד שאחד מצליח.
const YT_STRATEGIES = [
  { name: 'ברירת מחדל', args: [] },
  { name: 'android_vr', args: ['--extractor-args', 'youtube:player_client=android_vr'] },
  { name: 'tv_embedded', args: ['--extractor-args', 'youtube:player_client=tv_embedded'] },
  { name: 'ios', args: ['--extractor-args', 'youtube:player_client=ios'] },
  { name: 'web_safari', args: ['--extractor-args', 'youtube:player_client=web_safari'] }
];

const isDirectStream = url => /\.m3u8(\?|$)|\.mpd(\?|$)|^rtmps?:/i.test(url);

export class KotelEngine {
  constructor(doc, words) {
    this.doc = doc;
    this.aligner = new Aligner(words);
    this.clients = new Set();
    this.state = { mode: 'off', word: -1, confidence: 0, section: '', updatedAt: 0, source: '' };
    this.transcriptTail = [];
    this.proc = { ytdlp: null, ffmpeg: null };
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kotel-'));
    this.lastClientAt = 0;
    this.sectionOf = this._buildSectionMap();
    this.ffmpegPath = 'ffmpeg';
    resolveFfmpeg().then(p => { this.ffmpegPath = p; });
    setInterval(() => this._tick(), 1000).unref?.();
  }

  _buildSectionMap() {
    const map = [];
    for (const s of this.doc.sections) {
      let first = Infinity, last = -1;
      for (const p of s.paragraphs) for (const w of p.w) { if (w.i < first) first = w.i; if (w.i > last) last = w.i; }
      map.push({ from: first, to: last, title: s.title, slug: s.slug });
    }
    return map;
  }

  sectionFor(idx) {
    const s = this.sectionOf.find(x => idx >= x.from && idx <= x.to);
    return s ? s.title : '';
  }

  /* ---------- לקוחות (SSE) ---------- */
  addClient(res) {
    this.clients.add(res);
    this.lastClientAt = Date.now();
    this._send(res, 'status', this._statusPayload());
    if (this.state.word >= 0 && this.state.mode !== 'off') this._send(res, 'position', this._positionPayload());
    if (this.state.mode === 'off') this.start('demand');
    res.on('close', () => { this.clients.delete(res); });
  }

  get listeners() { return this.clients.size; }

  _send(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  }
  broadcast(event, data) { for (const c of this.clients) this._send(c, event, data); }

  _statusPayload() {
    const s = this.state;
    if (s.mode === 'off') {
      return { state: 'idle', message: this._idleMessage() };
    }
    if (s.mode === 'listening' && s.word < 0) return { state: 'listening' };
    if (s.mode === 'starting') return { state: 'starting' };
    return { state: s.mode };
  }

  _idleMessage() {
    if (!CFG.streamUrl) return 'המעקב החי מהכותל עדיין לא מחובר לשידור. אפשר לקרוא בקצב שלך.';
    if (!this._hasKey()) return 'המעקב החי ממתין להגדרת מנוע התמלול. אפשר לקרוא בקצב שלך.';
    return 'אין כרגע שידור סליחות חי מהכותל. המעקב יופעל אוטומטית כשהשידור יתחיל.';
  }

  _hasKey() { return CFG.provider === 'elevenlabs' ? !!CFG.elevenKey : !!CFG.openaiKey; }

  _positionPayload() {
    const s = this.state;
    return { word: s.word, confidence: s.confidence, section: s.section, mode: s.source || s.mode, at: s.updatedAt };
  }

  setPosition(word, confidence, source) {
    if (word == null || word < 0) return;
    this.state.word = word;
    this.state.confidence = confidence;
    this.state.section = this.sectionFor(word);
    this.state.source = source;
    this.state.updatedAt = Date.now();
    this.broadcast('position', this._positionPayload());
  }

  /* ---------- שליטה ידנית (גבאי/מנהל) ---------- */
  manual(word) {
    this.state.mode = 'manual';
    this.stopIngest();
    this.setPosition(word, 1, 'manual');
  }

  /* ---------- הפעלה / כיבוי ---------- */
  start(reason = 'manual') {
    if (this.state.mode === 'manual') return;
    if (!CFG.streamUrl || !this._hasKey()) {
      this.state.mode = 'off';
      this.broadcast('status', { state: 'idle', message: this._idleMessage() });
      return;
    }
    if (this.proc.ffmpeg || this.pendingStart) return;
    if (this.retryAfter && Date.now() < this.retryAfter) {
      this.broadcast('status', { state: 'idle', message: 'המעקב החי אינו זמין כרגע. אפשר לקרוא בקצב שלך.' });
      return;
    }
    this.pendingStart = true;
    this.state.mode = 'starting';
    this.broadcast('status', { state: 'starting' });
    this._startIngest(reason).finally(() => { this.pendingStart = false; });
  }

  stopIngest() {
    this.pendingStart = false;
    for (const k of ['ffmpeg', 'ytdlp']) {
      try { this.proc[k]?.kill('SIGKILL'); } catch {}
      this.proc[k] = null;
    }
  }

  stop() {
    this.stopIngest();
    this.state.mode = 'off';
    this.state.word = -1;
    this.transcriptTail = [];
    this.broadcast('status', { state: 'idle', message: this._idleMessage() });
  }

  async _startIngest() {
    const dir = this.tmpDir;
    for (const f of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }

    // שלב א: מקור ישיר (m3u8/mpd) נקלט כמו שהוא; אחרת yt-dlp מחלץ את הכתובת
    let mediaUrl;
    if (isDirectStream(CFG.streamUrl)) {
      mediaUrl = CFG.streamUrl;
    } else {
      try {
        mediaUrl = await this._resolveMediaUrl();
      } catch (e) {
        return this._fail('yt-dlp: ' + e.message);
      }
    }
    if (!this.pendingStart) return;   // בוטל בינתיים

    // שלב ב: ffmpeg קולט את ה-HLS ישירות וחותך לקטעי WAV
    const headers = CFG.streamReferer ? ['-headers', `Referer: ${CFG.streamReferer}\r\n`] : [];
    const ffmpeg = spawn(this.ffmpegPath || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      ...headers,
      '-i', mediaUrl,
      '-vn', '-ac', '1', '-ar', '16000', '-f', 'segment',
      '-segment_time', String(CFG.segSec), '-reset_timestamps', '1',
      path.join(dir, 'seg%05d.wav')
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    ffmpeg.on('error', e => this._fail('ffmpeg: ' + e.message));
    ffmpeg.stderr.on('data', d => console.warn('[kotel][ffmpeg]', String(d).trim().slice(0, 200)));
    ffmpeg.on('exit', code => {
      if (this.proc.ffmpeg !== ffmpeg) return;
      this.proc.ffmpeg = null;
      console.warn('[kotel] ffmpeg exited', code);
      // כתובות HLS פגות תוקף — מרעננים ומתחברים מחדש כל עוד יש מאזינים
      if (this.clients.size) setTimeout(() => { this.state.mode = 'off'; this.start('reconnect'); }, 5000);
    });

    this.proc.ffmpeg = ffmpeg;
    this.failures = 0;
    this.retryAfter = 0;
    this.state.mode = 'listening';
    this.broadcast('status', { state: 'listening' });
    this._watchSegments();
  }

  async _resolveMediaUrl() {
    const errors = [];
    for (const strat of YT_STRATEGIES) {
      try {
        const url = await this._tryYtDlp(strat);
        if (this.ytStrategy !== strat.name) {
          console.log(`[kotel] yt-dlp הצליח עם ${strat.name}`);
          this.ytStrategy = strat.name;
        }
        return url;
      } catch (e) {
        errors.push(`${strat.name}: ${e.message}`);
        if (!this.pendingStart) break;
      }
    }
    throw new Error(errors.join(' ;; ').slice(0, 600));
  }

  _tryYtDlp(strat) {
    return new Promise((resolve, reject) => {
      const args = ['--no-warnings', '--socket-timeout', '20', ...strat.args];
      if (CFG.ytCookies) args.push('--cookies', CFG.ytCookies);
      args.push('-f', CFG.ytFormat, '-g', CFG.streamUrl);
      const p = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      p.stdout.on('data', d => { out += d; });
      p.stderr.on('data', d => { err += d; });
      p.on('error', reject);
      const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 35000);
      p.on('exit', code => {
        clearTimeout(timer);
        const url = out.trim().split('\n').filter(Boolean).pop();
        if (code === 0 && url && /^https?:/.test(url)) return resolve(url);
        const detail = [err.trim(), out.trim()].filter(Boolean).join(' | ')
          .replace(/\s+/g, ' ').slice(0, 160);
        reject(new Error(detail || 'exit ' + code));
      });
      this.proc.ytdlp = p;
    });
  }

  _fail(msg) {
    console.error('[kotel] ' + msg);
    this.lastError = { at: new Date().toISOString(), message: String(msg).slice(0, 400) };
    this.failures = (this.failures || 0) + 1;
    // השהיה מצטברת: 30 שניות, דקה, שתיים… עד 10 דקות, כדי לא להציף את השירות
    this.retryAfter = Date.now() + Math.min(600000, 30000 * 2 ** (this.failures - 1));
    this.stopIngest();
    this.state.mode = 'off';
    this.broadcast('status', { state: 'idle', message: 'המעקב החי אינו זמין כרגע. אפשר לקרוא בקצב שלך.' });
  }

  _watchSegments() {
    if (this._watching) return;
    this._watching = true;
    const seen = new Set();
    const loop = async () => {
      if (!this.proc.ffmpeg) { this._watching = false; return; }
      try {
        const files = fs.readdirSync(this.tmpDir).filter(f => f.endsWith('.wav')).sort();
        // הקובץ האחרון עדיין נכתב — מעבדים רק את הסגורים
        for (const f of files.slice(0, -1)) {
          if (seen.has(f)) continue;
          seen.add(f);
          const full = path.join(this.tmpDir, f);
          this._processSegment(full).finally(() => { try { fs.unlinkSync(full); } catch {} });
        }
      } catch {}
      setTimeout(loop, 1000);
    };
    loop();
  }

  async _processSegment(file) {
    let text = '';
    try {
      const buf = fs.readFileSync(file);
      if (buf.length < 20000) return; // קטע קצר/שקט מדי
      text = await transcribe(buf);
    } catch (e) {
      console.warn('[kotel] transcribe failed:', e.message);
      return;
    }
    if (!text) return;
    const toks = tokenize(text);
    if (!toks.length) return;
    this.transcriptTail = this.transcriptTail.concat(toks).slice(-40);
    const hint = this.state.word;
    const r = this.aligner.locate(this.transcriptTail, hint);
    if (!r) return;
    // שמירה על יציבות: קפיצה רחוקה מתקבלת רק בוודאות גבוהה
    const jump = hint >= 0 ? Math.abs(r.word - hint) : 0;
    const minConf = jump > 250 ? Math.max(0.45, CFG.minConfidence) : CFG.minConfidence;
    if (r.confidence < minConf) return;
    this.setPosition(r.word, r.confidence, 'stt');
  }

  /* ---------- פעימה: המשך משוער + כיבוי בהיעדר מאזינים ---------- */
  _tick() {
    const now = Date.now();
    if (this.clients.size) this.lastClientAt = now;
    else if (this.proc.ytdlp && now - this.lastClientAt > CFG.idleStopMs) {
      console.log('[kotel] אין מאזינים — עוצר קליטה');
      this.stopIngest();
      this.state.mode = 'off';
      return;
    }
    if (this.state.mode !== 'listening' || this.state.word < 0) return;
    const since = now - this.state.updatedAt;
    if (since > 6000 && since < 90000) {
      const next = this.aligner.drift(this.state.word, 1000, CFG.wpm);
      if (next !== this.state.word) {
        this.state.word = next;
        this.state.section = this.sectionFor(next);
        this.state.updatedAt = now - (since - 1000);
        this.broadcast('position', { word: next, confidence: this.state.confidence, section: this.state.section, mode: 'drift', at: now });
      }
    }
  }
}

/* ---------- ספקי תמלול ---------- */
async function transcribe(wavBuffer) {
  if (CFG.provider === 'elevenlabs') return transcribeElevenLabs(wavBuffer);
  return transcribeOpenAI(wavBuffer);
}

async function transcribeOpenAI(wavBuffer) {
  const fd = new FormData();
  fd.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'chunk.wav');
  fd.append('model', CFG.openaiModel);
  fd.append('language', 'he');
  fd.append('prompt', 'סליחות נוסח עדות המזרח, פיוטים ותפילה בעברית.');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${CFG.openaiKey}` }, body: fd
  });
  if (!r.ok) throw new Error('OpenAI ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const j = await r.json();
  return j.text || '';
}

async function transcribeElevenLabs(wavBuffer) {
  const fd = new FormData();
  fd.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'chunk.wav');
  fd.append('model_id', 'scribe_v1');
  fd.append('language_code', 'heb');
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': CFG.elevenKey }, body: fd
  });
  if (!r.ok) throw new Error('ElevenLabs ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const j = await r.json();
  return j.text || '';
}

export const kotelConfig = CFG;
export { transcribe };
