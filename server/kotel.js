/* מנוע "מעקב אחרי הכותל":
   שידור חי -> חיתוך לקטעי אודיו -> תמלול בזמן אמת -> התאמה לטקסט הסליחות -> שידור מיקום ללקוחות.
   פועל רק כשיש מאזינים, כדי לא לבזבז קריאות API. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Aligner, tokenize } from './matcher.js';
import { Tracker } from './tracker.js';

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
  // מצלמת רחבת הכותל (24/7). הסליחות עצמן משודרות בערוץ כשידור חי נפרד, ולכן
  // המנוע מחפש קודם שידור חי ששמו "סליחות" בערוץ (channelUrl), ורק אחריו נופל למצלמה.
  streamUrl: process.env.KOTEL_STREAM_URL || 'https://www.youtube.com/watch?v=LMHUcDktP-w',
  channelUrl: process.env.KOTEL_CHANNEL_URL ?? 'https://www.youtube.com/channel/UCvcdHbNAQvbe2GuIDLhlwaw/streams',
  channelMatch: new RegExp(process.env.KOTEL_CHANNEL_MATCH || 'סליחות'),
  channelCheckMs: Number(process.env.KOTEL_CHANNEL_CHECK_MS || 180000),
  // 91 = 144p עם אודיו (~290kbps) — הזול ביותר לקליטה; נופל חזרה לאודיו בלבד אם קיים
  ytFormat: process.env.KOTEL_YTDLP_FORMAT || '91/bestaudio*/worst',
  // כתובת HLS ישירה נקלטת בלי yt-dlp כלל (חוסך את בדיקת הבוטים של יוטיוב)
  streamReferer: process.env.KOTEL_STREAM_REFERER || '',
  // לבדיקות על הקלטה של שידור שהסתיים: קריאה בקצב אמיתי, מנקודת התחלה נתונה
  realtime: process.env.KOTEL_REALTIME === '1',
  startSec: Number(process.env.KOTEL_START_SEC || 0),
  ytCookies: process.env.YTDLP_COOKIES || '',
  provider: (process.env.STT_PROVIDER || 'openai').toLowerCase(),
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
  elevenKey: process.env.ELEVENLABS_API_KEY || '',
  elevenModel: process.env.ELEVENLABS_STT_MODEL || 'scribe_v1',
  // הטיית התמלול לטקסט הצפוי: המשפטים הבאים מהמקום שבו אוחזים (עלות תמלול +20%)
  biasPrompt: process.env.STT_BIAS === '1',
  segSec: Number(process.env.KOTEL_SEGMENT_SEC || 12),
  idleStopMs: Number(process.env.KOTEL_IDLE_STOP_MS || 120000),
  minConfidence: Number(process.env.KOTEL_MIN_CONFIDENCE || 0.18),
  wpm: Number(process.env.KOTEL_WPM || 95),
  // כמה מילים מותר לדף להתקדם לבד מעבר לזיהוי האחרון. בלי תקרה הדף "בורח" קדימה
  // בזמן שירה ארוכה, והזיהוי הבא מושך אותו אחורה — וזה נראה כקפיצה.
  driftCap: Number(process.env.KOTEL_DRIFT_CAP || 30)
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

/** קישור מלוח הבקרה: רק http(s), כדי שלא יתפרש כדגל של yt-dlp או כקובץ מקומי */
export function cleanSourceUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 500) throw new Error('קישור לא תקין');
  return u;
}

/** נקודת התחלה מתוך הקישור (?t=2400 או t=1h2m3s) — לבחינה על הקלטה של ערב קודם */
function startFromUrl(url) {
  const m = /[?&#]t=([0-9hms]+)/.exec(url);
  if (!m) return 0;
  if (/^\d+s?$/.test(m[1])) return parseInt(m[1], 10);
  const [, h = 0, mi = 0, se = 0] = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(m[1]) || [];
  return (+h) * 3600 + (+mi) * 60 + (+se);
}

const isDirectStream = url => /\.m3u8(\?|$)|\.mpd(\?|$)|^rtmps?:/i.test(url);
// קובץ מקומי (לבדיקות): נקרא בקצב אמיתי, כאילו היה שידור
const isLocalFile = url => !/^[a-z]+:/i.test(url) && fs.existsSync(url);

// מזין מרוחק: מכונה שיוטיוב אינה חוסמת קולטת ומתמללת, ושולחת לכאן רק מיקומים.
// כל עוד הוא שולח פעימות, השרת אינו מנסה לקלוט בעצמו.
const REMOTE_TTL_MS = 75000;

// yt-dlp כותב חזרה לקובץ העוגיות אחרי כל ריצה, וקבצי סוד ב-Render הם לקריאה בלבד.
// לכן מעתיקים לעותק זמני בר-כתיבה, ומרעננים אותו בכל עלייה של השירות.
function prepareCookies(src) {
  if (!src) return '';
  try {
    if (!fs.existsSync(src)) {
      console.warn('[kotel] קובץ העוגיות לא נמצא:', src);
      return '';
    }
    const dest = path.join(os.tmpdir(), 'yt-cookies.txt');
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o600);
    console.log('[kotel] קובץ עוגיות נטען');
    return dest;
  } catch (e) {
    console.warn('[kotel] טעינת קובץ העוגיות נכשלה:', e.message);
    return '';
  }
}

export class KotelEngine {
  constructor(doc, words, { onPosition } = {}) {
    this.doc = doc;
    this.onPosition = onPosition;
    this.remote = { at: 0, ingesting: false, url: '' };
    this.override = '';   // קישור שהוזן בלוח הבקרה — גובר על הכול
    this.autoUrl = '';    // שידור סליחות חי שנמצא בערוץ הכותל
    this.autoTitle = '';
    this.channelCheckedAt = 0;
    this.aligner = new Aligner(words);
    this.tracker = new Tracker(this.aligner);
    setBiasText(doc);
    this.sttWord = -1;   // הזיהוי האחרון מהתמלול (לא כולל התקדמות משוערת)
    this.clients = new Set();
    this.state = { mode: 'off', word: -1, confidence: 0, section: '', updatedAt: 0, source: '' };
    this.pace = [];   // זיהויים אחרונים, לחישוב קצב אמירה בפועל
    this.proc = { ytdlp: null, ffmpeg: null };
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kotel-'));
    this.lastClientAt = 0;
    this.sectionOf = this._buildSectionMap();
    this.ffmpegPath = 'ffmpeg';
    this.cookiesPath = prepareCookies(CFG.ytCookies);
    resolveFfmpeg().then(p => { this.ffmpegPath = p; });
    setInterval(() => this._tick(), 1000).unref?.();
  }

  /* ---------- מקור השידור ---------- */
  get streamUrl() { return this.override || this.autoUrl || CFG.streamUrl; }

  sourceInfo() {
    return {
      url: this.streamUrl,
      kind: this.override ? 'override' : this.autoUrl ? 'channel' : 'camera',
      title: this.override ? '' : this.autoTitle
    };
  }

  /** קישור מלוח הבקרה ('' = חזרה לערוץ הכותל). מחזיר true אם המקור השתנה. */
  setSource(url) {
    url = cleanSourceUrl(url);
    if (url === this.override) return false;
    this.override = url;
    this._switchSource();
    return true;
  }

  /** מעבר מקור: המיקום הקודם אינו תקף לשידור אחר */
  _switchSource() {
    const hadIngest = !!(this.proc.ffmpeg || this.pendingStart);
    this.stopIngest();
    this.sttWord = -1;
    this.pace = [];
    this.tracker.reset();
    if (this.state.mode !== 'manual') {
      this.state.word = -1;
      this.state.section = '';
      if (hadIngest || this.clients.size) {
        this.state.mode = 'off';
        this.retryAfter = 0;
        this.failures = 0;
        this.start('source');
      }
    }
    this.broadcast('status', this._statusPayload());
  }

  /** קובץ מקומי או HLS ישיר ב-KOTEL_STREAM_URL (בדיקות) — לא מחליפים אותו בשידור מהערוץ */
  _pinned() { return isLocalFile(CFG.streamUrl) || isDirectStream(CFG.streamUrl); }

  /** מחפש בערוץ הכותל שידור חי של סליחות. זול (~1 שנייה, בלי הורדה). */
  findChannelLive() {
    if (!CFG.channelUrl) return Promise.resolve(null);
    return new Promise(resolve => {
      const args = ['--no-warnings', '--flat-playlist', '--playlist-end', '10',
        '--print', '%(id)s\t%(live_status)s\t%(title)s'];
      if (this.cookiesPath) args.push('--cookies', this.cookiesPath);
      const p = spawn('yt-dlp', [...args, '--', CFG.channelUrl], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', d => { out += d; });
      p.on('error', () => resolve(null));
      const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 30000);
      p.on('exit', code => {
        clearTimeout(timer);
        if (code !== 0 && !out) return resolve(null);
        for (const line of out.split('\n')) {
          const [id, status, ...t] = line.split('\t');
          const title = t.join(' ');
          if (id && status === 'is_live' && CFG.channelMatch.test(title))
            return resolve({ url: 'https://www.youtube.com/watch?v=' + id, title });
        }
        resolve({ url: '', title: '' });
      });
    });
  }

  /** מעדכן את השידור מהערוץ; אם השתנה בזמן קליטה — עובר אליו */
  async _refreshChannel() {
    this.channelCheckedAt = Date.now();
    const found = await this.findChannelLive();
    if (!found) return false;   // הבדיקה נכשלה — נשארים עם מה שיש
    const changed = found.url !== this.autoUrl;
    this.autoUrl = found.url;
    this.autoTitle = found.title;
    if (changed) console.log('[kotel] מקור מהערוץ:', found.url ? `${found.title} (${found.url})` : 'אין סליחות חיות — מצלמת הרחבה');
    return changed;
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
    if (!this.streamUrl) return 'המעקב החי מהכותל עדיין לא מחובר לשידור. אפשר לקרוא בקצב שלך.';
    if (!this._hasKey()) return 'המעקב החי ממתין להגדרת מנוע התמלול. אפשר לקרוא בקצב שלך.';
    return 'אין כרגע שידור סליחות חי מהכותל. המעקב יופעל אוטומטית כשהשידור יתחיל.';
  }

  _hasKey() { return CFG.provider === 'elevenlabs' ? !!CFG.elevenKey : !!CFG.openaiKey; }

  _positionPayload() {
    const s = this.state;
    return { word: s.word, confidence: s.confidence, section: s.section, mode: s.source || s.mode, at: s.updatedAt };
  }

  /** קצב האמירה בפועל, לפי הזיהויים האחרונים. פיוט מושר איטי בהרבה מקטע נאמר,
   *  וקצב קבוע היה מקדם את הדף הרבה לפני החזן. */
  observedWpm() {
    if (this.pace.length < 3) return CFG.wpm;
    const first = this.pace[0], last = this.pace[this.pace.length - 1];
    const minutes = (last.at - first.at) / 60000;
    const words = last.word - first.word;
    if (minutes <= 0 || words <= 0) return CFG.wpm;
    return Math.max(20, Math.min(200, words / minutes));
  }

  setPosition(word, confidence, source) {
    if (word == null || word < 0) return;
    this.state.word = word;
    this.state.confidence = confidence;
    this.state.section = this.sectionFor(word);
    this.state.source = source;
    this.state.updatedAt = Date.now();
    if (source === 'stt') {
      this.sttWord = word;
      this.pace.push({ word, at: this.state.updatedAt });
      if (this.pace.length > 8) this.pace.shift();
      this.onPosition?.(word, confidence);
    } else if (source === 'manual') {
      this.pace = [];
      this.sttWord = word;
      this.tracker.reset(word, Date.now());
    }
    this.broadcast('position', this._positionPayload());
  }

  /* ---------- שליטה ידנית (גבאי/מנהל) ---------- */
  manual(word) {
    this.state.mode = 'manual';
    this.stopIngest();
    this.setPosition(word, 1, 'manual');
  }

  /* ---------- מזין מרוחק ---------- */
  remoteAlive() { return Date.now() - this.remote.at < REMOTE_TTL_MS; }

  remoteBeat(ingesting) {
    this.remote = { at: Date.now(), ingesting: !!ingesting };
    if (this.state.mode === 'manual') return;
    this.stopIngest();   // הקליטה המקומית נחסמת ממילא; המזין מחליף אותה
    const mode = ingesting ? 'listening' : (this.clients.size ? 'starting' : 'off');
    if (mode !== this.state.mode) {
      this.state.mode = mode;
      this.broadcast('status', this._statusPayload());
    }
  }

  remotePosition(word, confidence) {
    if (this.state.mode === 'manual') return;   // סנכרון הגבאי גובר
    this.remoteBeat(true);
    this.setPosition(word, confidence, 'stt');
  }

  /* ---------- הפעלה / כיבוי ---------- */
  start(reason = 'manual') {
    if (this.state.mode === 'manual') return;
    if (this.remoteAlive()) return this.remoteBeat(this.remote.ingesting);
    if (!this.streamUrl || !this._hasKey()) {
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
    this.sttWord = -1;
    this.tracker.reset();
    this.pace = [];   // זיהויים אחרונים, לחישוב קצב אמירה בפועל
    this.broadcast('status', { state: 'idle', message: this._idleMessage() });
  }

  async _startIngest() {
    const dir = this.tmpDir;
    for (const f of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }

    // שלב 0: בלי קישור מלוח הבקרה — בודקים אם יש בערוץ שידור סליחות חי
    if (!this.override && !this._pinned()) await this._refreshChannel();
    if (!this.pendingStart) return;
    const src = this.streamUrl;

    // שלב א: מקור ישיר (m3u8/mpd) נקלט כמו שהוא; אחרת yt-dlp מחלץ את הכתובת
    let mediaUrl, isLive = true;
    const local = isLocalFile(src) && !this.override;
    if (local || isDirectStream(src)) {
      mediaUrl = src;
      isLive = !local;
    } else {
      try {
        ({ url: mediaUrl, isLive } = await this._resolveMediaUrl(src));
      } catch (e) {
        return this._fail('yt-dlp: ' + e.message);
      }
    }
    if (!this.pendingStart || src !== this.streamUrl) return;   // בוטל או שהמקור הוחלף בינתיים
    // הקלטה (לא שידור חי) מנוגנת בקצב אמיתי, מנקודת ההתחלה שבקישור
    const startSec = this.override ? startFromUrl(src) : CFG.startSec;
    const realtime = local || CFG.realtime || !isLive;

    // שלב ב: ffmpeg קולט את ה-HLS ישירות וחותך לקטעי WAV
    const headers = CFG.streamReferer ? ['-headers', `Referer: ${CFG.streamReferer}\r\n`] : [];
    const ffmpeg = spawn(this.ffmpegPath || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      ...(local ? [] : ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5']),
      ...headers,
      ...(realtime ? ['-re'] : []),
      ...(startSec ? ['-ss', String(startSec)] : []),
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
    this.source = { url: src, live: isLive, startSec, at: Date.now() };
    console.log(`[kotel] קולט: ${src}${isLive ? '' : ' (הקלטה' + (startSec ? `, מ-${startSec} שנ׳` : '') + ')'}`);
    this.failures = 0;
    this.retryAfter = 0;
    this.state.mode = 'listening';
    this.broadcast('status', { state: 'listening' });
    this._watchSegments();
  }

  async _resolveMediaUrl(src) {
    const errors = [];
    for (const strat of YT_STRATEGIES) {
      try {
        const r = await this._tryYtDlp(strat, src);
        if (this.ytStrategy !== strat.name) {
          console.log(`[kotel] yt-dlp הצליח עם ${strat.name}`);
          this.ytStrategy = strat.name;
        }
        return r;
      } catch (e) {
        errors.push(`${strat.name}: ${e.message}`);
        if (!this.pendingStart) break;
      }
    }
    throw new Error(errors.join(' ;; ').slice(0, 600));
  }

  _tryYtDlp(strat, src) {
    return new Promise((resolve, reject) => {
      const args = ['--no-warnings', '--socket-timeout', '20', ...strat.args];
      if (this.cookiesPath) args.push('--cookies', this.cookiesPath);
      args.push('-f', CFG.ytFormat, '--print', 'is_live', '-g', '--', src);
      const p = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      p.stdout.on('data', d => { out += d; });
      p.stderr.on('data', d => { err += d; });
      p.on('error', reject);
      const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 35000);
      p.on('exit', code => {
        clearTimeout(timer);
        const lines = out.trim().split('\n').filter(Boolean);
        const url = lines.pop();
        // is_live מודפס לפני הכתובת; ערך לא ידוע נחשב שידור חי (כך היה עד כה)
        if (code === 0 && url && /^https?:/.test(url)) return resolve({ url, isLive: lines[0] !== 'False' });
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
      text = await transcribe(buf, { hintWord: this.sttWord });
    } catch (e) {
      console.warn('[kotel] transcribe failed:', e.message);
      return;
    }
    if (!text) return;
    const toks = tokenize(text);
    if (!toks.length) return;
    // היגיון ההתקדמות (tracker.js) מחליט אם זו התקדמות רגילה, דילוג מאושר או רעש
    const r = this.tracker.update(toks, Date.now());
    if (r) this.setPosition(r.word, r.confidence, 'stt');
  }

  /* ---------- פעימה: המשך משוער + כיבוי בהיעדר מאזינים ---------- */
  _tick() {
    const now = Date.now();
    if (this.clients.size) this.lastClientAt = now;
    else if ((this.proc.ytdlp || this.proc.ffmpeg) && now - this.lastClientAt > CFG.idleStopMs) {
      console.log('[kotel] אין מאזינים — עוצר קליטה');
      this.stopIngest();
      this.state.mode = 'off';
      return;
    }
    // בזמן קליטה מהערוץ: בודקים מדי פעם אם התחיל (או נגמר) שידור סליחות חי
    if (this.proc.ffmpeg && !this.override && CFG.channelUrl && !this._pinned()
        && now - this.channelCheckedAt > CFG.channelCheckMs) {
      this._refreshChannel().then(changed => { if (changed && !this.override) this._switchSource(); });
    }
    // המזין המרוחק השתתק: לא ממשיכים לקדם את הדף על סמך ניחוש
    if (this.state.mode === 'listening' && !this.proc.ffmpeg && !this.remoteAlive() && this.remote.at) {
      this.remote.at = 0;
      this.state.mode = 'off';
      this.broadcast('status', { state: 'idle', message: this._idleMessage() });
      return;
    }
    if (this.state.mode !== 'listening' || this.state.word < 0) return;
    const since = now - this.state.updatedAt;
    if (since > 6000 && since < 90000) {
      const next = this.aligner.drift(this.state.word, 1000, this.observedWpm());
      const ahead = this.sttWord >= 0 ? this.aligner.toDense(next) - this.aligner.toDense(this.sttWord) : 0;
      if (next !== this.state.word && ahead <= CFG.driftCap) {
        this.state.word = next;
        this.state.section = this.sectionFor(next);
        this.state.updatedAt = now - (since - 1000);
        this.broadcast('position', { word: next, confidence: this.state.confidence, section: this.state.section, mode: 'drift', at: now });
      }
    }
  }
}

/* ---------- הטיה לטקסט הצפוי ---------- */
let plainWords = [];   // אינדקס גלובלי -> מילה בלי ניקוד
export function setBiasText(doc) {
  plainWords = [];
  for (const s of doc.sections) for (const p of s.paragraphs) for (const w of p.w) {
    plainWords[w.i] = w.t.replace(/[\u0591-\u05C7]/g, '').replace(/[^א-ת ]/g, '').trim();
  }
}

/** צירופים של 3 מילים מהמקום הנוכחי והלאה — מה שהחזן צפוי לומר ב-12 השניות הקרובות */
function expectedPhrases(hintWord, max = 90) {
  if (!CFG.biasPrompt || hintWord == null || hintWord < 0 || !plainWords.length) return [];
  const words = [];
  for (let i = Math.max(0, hintWord - 6); i < plainWords.length && words.length < max * 3; i++) {
    const w = plainWords[i];
    if (w) words.push(w === 'יהוה' ? 'ה׳' : w);
  }
  const out = [];
  for (let i = 0; i + 3 <= words.length && out.length < max; i += 3) {
    const ph = words.slice(i, i + 3).join(' ').replace(/[<>{}[\]\\]/g, '');
    if (ph.length < 50) out.push(ph);
  }
  return out;
}

/* ---------- ספקי תמלול ---------- */
async function transcribe(wavBuffer, { hintWord = -1 } = {}) {
  const phrases = expectedPhrases(hintWord);
  if (CFG.provider === 'elevenlabs') return transcribeElevenLabs(wavBuffer, phrases);
  return transcribeOpenAI(wavBuffer, phrases);
}

async function transcribeOpenAI(wavBuffer, phrases = []) {
  const fd = new FormData();
  fd.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'chunk.wav');
  fd.append('model', CFG.openaiModel);
  fd.append('language', 'he');
  fd.append('prompt', phrases.length
    ? 'סליחות נוסח עדות המזרח. הטקסט הצפוי: ' + phrases.slice(0, 30).join(' ')
    : 'סליחות נוסח עדות המזרח, פיוטים ותפילה בעברית.');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${CFG.openaiKey}` }, body: fd
  });
  if (!r.ok) throw new Error('OpenAI ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const j = await r.json();
  return j.text || '';
}

async function transcribeElevenLabs(wavBuffer, phrases = []) {
  const fd = new FormData();
  fd.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'chunk.wav');
  fd.append('model_id', CFG.elevenModel);
  fd.append('language_code', 'heb');
  // בלי זה, קטע שבו הקהל שר חוזר כ"[מוזיקה]" או "[שירה]" — מילים שאינן בטקסט
  // ומזהמות את חלון ההתאמה. עדיף תמלול ריק מאשר תמלול שגוי.
  fd.append('tag_audio_events', 'false');
  for (const ph of phrases) fd.append('keyterms', ph);
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': CFG.elevenKey }, body: fd
  });
  if (!r.ok) throw new Error('ElevenLabs ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const j = await r.json();
  return j.text || '';
}

export const kotelConfig = CFG;
export { transcribe };
