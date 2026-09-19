import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KotelEngine, kotelConfig, resolveFfmpeg, cleanSourceUrl } from './kotel.js';
import { execFileSync } from 'node:child_process';
import { recordHit, recordPulse, recordEvent, stats, liveFeed, adStats, isBot } from './analytics.js';
import { adById } from './ads.js';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const doc = JSON.parse(fs.readFileSync(path.join(root, 'data/slichot.json'), 'utf8'));
const words = JSON.parse(fs.readFileSync(path.join(root, 'data/index_words.json'), 'utf8'));
const kotel = new KotelEngine(doc, words);

// קישור שידור מלוח הבקרה נשמר בדיסק, כדי שלא ייעלם כשהשירות מתעורר מחדש
const SOURCE_FILE = path.join(process.env.DATA_DIR || path.join(root, 'data'), 'live-source.json');
try { kotel.override = cleanSourceUrl(JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8')).url); } catch {}

/* ---------- אבטחה בסיסית + קאשינג ---------- */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path === '/admin' || req.path === '/sync') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

// הגבלת קצב פשוטה בזיכרון (לפי IP): נגד ניחוש טוקן ונגד הצפת נקודות המדידה
function rateLimit(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const k = req.ip || 'x';
    const n = (hits.get(k) || 0) + 1;
    hits.set(k, n);
    if (n > max) return res.status(429).json({ error: 'too many requests' });
    next();
  };
}
const adminLimit = rateLimit(120, 60e3);
const failLimit = new Map(); // ניסיונות טוקן כושלים לפי IP
setInterval(() => failLimit.clear(), 15 * 60e3).unref();
const beaconLimit = rateLimit(240, 60e3);

/* ---------- מעקב חי ---------- */
const sseByIp = new Map();
app.get('/api/live/stream', (req, res) => {
  const ip = req.ip || 'x';
  if ((sseByIp.get(ip) || 0) >= 6) return res.status(429).end();
  sseByIp.set(ip, (sseByIp.get(ip) || 0) + 1);
  res.on('close', () => { const c = (sseByIp.get(ip) || 1) - 1; if (c <= 0) sseByIp.delete(ip); else sseByIp.set(ip, c); });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
  res.on('close', () => clearInterval(ping));
  kotel.addClient(res);
});

app.get('/api/live/state', (_req, res) => {
  res.json({
    mode: kotel.state.mode, word: kotel.state.word, section: kotel.state.section,
    confidence: kotel.state.confidence, listeners: kotel.listeners,
    configured: !!kotelConfig.streamUrl, provider: kotelConfig.provider
  });
});

const tokenOk = t => {
  if (!ADMIN_TOKEN || !t) return false;
  const a = crypto.createHash('sha256').update(String(t)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
};
function requireAdmin(req, res, next) {
  adminLimit(req, res, () => {
    const ip = req.ip || 'x';
    if ((failLimit.get(ip) || 0) >= 20) return res.status(429).json({ error: 'too many failed attempts' });
    const t = req.get('x-admin-token') || '';
    if (!tokenOk(t)) {
      failLimit.set(ip, (failLimit.get(ip) || 0) + 1);
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  });
}

// סנכרון ידני (למשל ע"י גבאי): { word } או { section: "slug" }
app.post('/api/live/manual', requireAdmin, (req, res) => {
  let word = Number(req.body?.word);
  if (req.body?.section) {
    const sec = doc.sections.find(s => s.slug === req.body.section);
    if (sec) word = sec.paragraphs[0].w[0].i;
  }
  if (!Number.isFinite(word)) return res.status(400).json({ error: 'word or section required' });
  kotel.manual(word);
  res.json({ ok: true, word, section: kotel.state.section });
});

// מזין מרוחק (scripts/kotel_feeder.mjs): פעימה, ומיקום כשזוהה. מחזיר את מספר המאזינים,
// כדי שהמזין יקלוט (ויוציא כסף על תמלול) רק כשמישהו באמת עוקב.
app.post('/api/live/remote', requireAdmin, (req, res) => {
  const word = Number(req.body?.word);
  const confidence = Number(req.body?.confidence) || 0;
  if (Number.isFinite(word) && word >= 0 && word < doc.wordCount) kotel.remotePosition(word, confidence);
  else kotel.remoteBeat(!!req.body?.ingesting, req.body?.idle);
  const src = req.body?.source;
  if (src && typeof src.url === 'string') {
    kotel.remoteSource = { url: src.url.slice(0, 500), kind: String(src.kind || ''), title: String(src.title || '').slice(0, 200), at: Date.now() };
  }
  // override: הקישור מלוח הבקרה ('' = ערוץ הכותל). המזין עובר אליו בפעימה הבאה.
  res.json({ ok: true, listeners: kotel.listeners, mode: kotel.state.mode, override: kotel.override });
});

// מקור השידור: קישור לבחינה (שידור חי או הקלטה, אפשר עם ?t=שניות), או ריק לחזרה לערוץ הכותל
app.get('/api/live/source', requireAdmin, (_req, res) => res.json(sourceStatus()));
app.post('/api/live/source', requireAdmin, (req, res) => {
  try {
    kotel.setSource(req.body?.url || '');
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  try {
    fs.mkdirSync(path.dirname(SOURCE_FILE), { recursive: true });
    fs.writeFileSync(SOURCE_FILE, JSON.stringify({ url: kotel.override }));
  } catch (e) { console.warn('[source] לא נשמר:', e.message); }
  res.json(sourceStatus());
});

function sourceStatus() {
  const feederAlive = kotel.remoteAlive();
  return {
    override: kotel.override,
    mode: kotel.state.mode,
    listeners: kotel.listeners,
    section: kotel.state.section,
    word: kotel.state.word,
    feeder: feederAlive ? { ...kotel.remoteSource, ingesting: kotel.remote.ingesting, idle: kotel.remote.message, lastBeat: kotel.remote.at } : null
  };
}

app.post('/api/live/control', requireAdmin, (req, res) => {
  const a = req.body?.action;
  if (a === 'start') { kotel.state.mode = 'off'; kotel.start('admin'); }
  else if (a === 'stop') kotel.stop();
  else return res.status(400).json({ error: 'action must be start|stop' });
  res.json({ ok: true, mode: kotel.state.mode });
});

/* ---------- מדידת כניסות ---------- */
const parseBeacon = (req, _res, next) => {
  if (typeof req.body === 'string') { try { req.body = JSON.parse(req.body); } catch { req.body = {}; } }
  next();
};
app.use(['/api/hit', '/api/pulse', '/api/leave', '/api/event'], beaconLimit);
app.use('/api/hit', express.text({ type: '*/*', limit: '16kb' }), parseBeacon);
app.use('/api/pulse', express.text({ type: '*/*', limit: '8kb' }), parseBeacon);
app.use('/api/leave', express.text({ type: '*/*', limit: '8kb' }), parseBeacon);
app.use('/api/event', express.text({ type: '*/*', limit: '8kb' }), parseBeacon);

app.post('/api/hit', (req, res) => { try { recordHit(req.body || {}, req); } catch (e) { console.warn(e.message); } res.status(204).end(); });
app.post('/api/pulse', (req, res) => { try { recordPulse(req.body || {}); } catch {} res.status(204).end(); });
app.post('/api/leave', (req, res) => { try { recordPulse(req.body || {}); } catch {} res.status(204).end(); });
app.post('/api/event', (req, res) => { try { recordEvent(req.body || {}); } catch {} res.status(204).end(); });

app.get('/api/stats', requireAdmin, (_req, res) => res.json({ ...stats(), ads: adStats(), liveListeners: kotel.listeners, feed: liveFeed() }));

/* ---------- פרסומות: קליק נרשם בשרת ומפנה לכתובת קבועה מ-ads.js ---------- */
app.get('/go/:id', (req, res) => {
  const ad = adById(req.params.id);
  if (!ad) return res.redirect(302, '/');
  if (!isBot(req.get('user-agent'))) {
    try { recordEvent({ event: 'ad_click', sid: String(req.query.s || ''), meta: { ad: req.params.id } }); } catch {}
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.redirect(302, ad.url);
});
// אבחון תלויות נבדק פעם אחת בעלייה — בדיקת הבריאות נקראת תדיר ואסור שתחסום
const has = (bin, args) => { try { execFileSync(bin, args, { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; } };
const deps = { ffmpeg: false, ytdlp: false };
resolveFfmpeg().then(p => { deps.ffmpeg = has(p, ['-version']); deps.ytdlp = has('yt-dlp', ['--version']); });

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  uptime: Math.round(process.uptime()),
  listeners: kotel.listeners,
  mode: kotel.state.mode,
  live: {
    stream: !!kotelConfig.streamUrl,
    transcriber: kotelConfig.provider,
    keyConfigured: kotelConfig.provider === 'elevenlabs' ? !!kotelConfig.elevenKey : !!kotelConfig.openaiKey,
    ffmpeg: deps.ffmpeg,
    ytdlp: deps.ytdlp,
    cookies: !!kotel.cookiesPath,
    ytStrategy: kotel.ytStrategy || null,
    lastError: kotel.lastError || null
  },
  words: doc.wordCount, sections: doc.sections.length
}));

/* ---------- לוח בקרה ---------- */
app.get('/admin', (_req, res) => res.sendFile(path.join(root, 'public/admin.html')));
app.get('/sync', (_req, res) => res.sendFile(path.join(root, 'public/sync.html')));

/* ---------- סטטי ---------- */
app.use(express.static(path.join(root, 'public'), {
  maxAge: '1h',
  redirect: false,
  setHeaders(res, file) {
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    if (file.endsWith('.css') || file.endsWith('.js')) res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

app.get('/data/slichot.json', (_req, res) => res.sendFile(path.join(root, 'data/slichot.json')));

app.use((_req, res) => res.status(404).sendFile(path.join(root, 'public/index.html')));

app.listen(PORT, () => {
  console.log(`סליחות עדות המזרח — פועל על פורט ${PORT}`);
  console.log(`  מעקב כותל: ${kotelConfig.streamUrl ? 'שידור מוגדר' : 'לא מוגדר'} · תמלול: ${kotelConfig.provider}`);
  console.log(`  לוח בקרה: /admin ${ADMIN_TOKEN ? '(מוגן בטוקן)' : '(ADMIN_TOKEN לא הוגדר — הסטטיסטיקות חסומות)'}`);
});
