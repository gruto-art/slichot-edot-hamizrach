import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KotelEngine, kotelConfig, resolveFfmpeg } from './kotel.js';
import { execFileSync } from 'node:child_process';
import { recordHit, recordPulse, recordEvent, stats, liveFeed } from './analytics.js';

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

/* ---------- אבטחה בסיסית + קאשינג ---------- */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/* ---------- מעקב חי ---------- */
app.get('/api/live/stream', (req, res) => {
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

function requireAdmin(req, res, next) {
  const t = req.get('x-admin-token') || req.query.token || '';
  if (!ADMIN_TOKEN || t !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
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
  else kotel.remoteBeat(!!req.body?.ingesting);
  res.json({ ok: true, listeners: kotel.listeners, mode: kotel.state.mode });
});

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
app.use('/api/hit', express.text({ type: '*/*', limit: '16kb' }), parseBeacon);
app.use('/api/pulse', express.text({ type: '*/*', limit: '8kb' }), parseBeacon);
app.use('/api/leave', express.text({ type: '*/*', limit: '8kb' }), parseBeacon);
app.use('/api/event', express.text({ type: '*/*', limit: '8kb' }), parseBeacon);

app.post('/api/hit', (req, res) => { try { recordHit(req.body || {}, req); } catch (e) { console.warn(e.message); } res.status(204).end(); });
app.post('/api/pulse', (req, res) => { try { recordPulse(req.body || {}); } catch {} res.status(204).end(); });
app.post('/api/leave', (req, res) => { try { recordPulse(req.body || {}); } catch {} res.status(204).end(); });
app.post('/api/event', (req, res) => { try { recordEvent(req.body || {}); } catch {} res.status(204).end(); });

app.get('/api/stats', requireAdmin, (_req, res) => res.json({ ...stats(), liveListeners: kotel.listeners, feed: liveFeed() }));
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
