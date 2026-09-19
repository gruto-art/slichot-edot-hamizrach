/* מעקב כניסות מדויק — first-party, ללא עוגיות צד שלישי.
   אחסון ב-SQLite (node:sqlite). אם אינו זמין — נפילה חיננית לזיכרון + קובץ JSON. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const DB_PATH = path.join(DATA_DIR, 'analytics.db');
const SALT = process.env.ANALYTICS_SALT || 'slichot-edot-hamizrach';

let db = null;
try {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS sessions(
      sid TEXT PRIMARY KEY, vid TEXT, started INTEGER, last INTEGER,
      active_ms INTEGER DEFAULT 0, max_scroll INTEGER DEFAULT 0,
      is_returning INTEGER DEFAULT 0, used_live INTEGER DEFAULT 0,
      path TEXT, ref TEXT, ref_host TEXT,
      utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
      device TEXT, os TEXT, browser TEXT, screen TEXT, lang TEXT, tz TEXT,
      ip_hash TEXT, country TEXT, bot INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS events(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, sid TEXT, vid TEXT, name TEXT, meta TEXT);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started);
    CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions(last);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
  `);
  console.log('[analytics] SQLite ready:', DB_PATH);
} catch (e) {
  db = null;
  console.warn('[analytics] SQLite unavailable, using memory store:', e.message);
}

const mem = { sessions: new Map(), events: [] };

const hash = s => crypto.createHash('sha256').update(SALT + '|' + s).digest('hex').slice(0, 16);

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pingdom|gtmetrix|semrush|ahrefs|python-requests|curl|wget/i;

export const isBot = (ua = '') => BOT_RE.test(ua || '');

export function parseUA(ua = '') {
  const device = /iPad|Tablet/i.test(ua) ? 'tablet'
    : /Mobi|Android|iPhone|iPod/i.test(ua) ? 'mobile' : 'desktop';
  const os = /iPhone|iPad|iPod|iOS/i.test(ua) ? 'iOS'
    : /Android/i.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Linux/i.test(ua) ? 'Linux' : 'אחר';
  const browser = /Edg\//i.test(ua) ? 'Edge'
    : /OPR\/|Opera/i.test(ua) ? 'Opera'
    : /Chrome\//i.test(ua) && !/Chromium/i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Safari\//i.test(ua) ? 'Safari' : 'אחר';
  return { device, os, browser, bot: BOT_RE.test(ua) ? 1 : 0 };
}

function refHost(ref) {
  try { return ref ? new URL(ref).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
}

export function recordHit(body, req) {
  const now = Date.now();
  const ua = String(body.ua || req.headers['user-agent'] || '').slice(0, 400);
  const { device, os, browser, bot } = parseUA(ua);
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  const row = {
    sid: String(body.sid || '').slice(0, 64),
    vid: String(body.vid || '').slice(0, 64),
    started: now, last: now, active_ms: 0, max_scroll: 0,
    returning: body.returning ? 1 : 0, used_live: 0,
    path: String(body.path || '/').slice(0, 200),
    ref: String(body.ref || '').slice(0, 300),
    ref_host: refHost(body.ref),
    utm_source: String(body.utm?.source || '').slice(0, 80),
    utm_medium: String(body.utm?.medium || '').slice(0, 80),
    utm_campaign: String(body.utm?.campaign || '').slice(0, 80),
    device, os, browser,
    screen: String(body.screen || '').slice(0, 20),
    lang: String(body.lang || '').slice(0, 20),
    tz: String(body.tz || '').slice(0, 60),
    ip_hash: ip ? hash(ip) : '',
    country: String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || '').slice(0, 4),
    bot
  };
  if (!row.sid) return;
  if (db) {
    db.prepare(`INSERT OR REPLACE INTO sessions
      (sid,vid,started,last,active_ms,max_scroll,is_returning,used_live,path,ref,ref_host,
       utm_source,utm_medium,utm_campaign,device,os,browser,screen,lang,tz,ip_hash,country,bot)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.sid, row.vid, row.started, row.last, 0, 0, row.returning, 0, row.path, row.ref, row.ref_host,
        row.utm_source, row.utm_medium, row.utm_campaign, row.device, row.os, row.browser,
        row.screen, row.lang, row.tz, row.ip_hash, row.country, row.bot);
  } else {
    mem.sessions.set(row.sid, row);
    if (mem.sessions.size > 20000) mem.sessions.delete(mem.sessions.keys().next().value);
  }
}

export function recordPulse(body) {
  const sid = String(body.sid || '').slice(0, 64);
  if (!sid) return;
  const active = Math.max(0, Math.min(6 * 3600e3, Number(body.activeMs) || 0));
  const scroll = Math.max(0, Math.min(100, Number(body.maxScroll) || 0));
  const live = body.live ? 1 : 0;
  const now = Date.now();
  if (db) {
    db.prepare(`UPDATE sessions SET last=?, active_ms=MAX(active_ms,?), max_scroll=MAX(max_scroll,?),
                used_live=MAX(used_live,?) WHERE sid=?`).run(now, active, scroll, live, sid);
  } else {
    const s = mem.sessions.get(sid);
    if (s) { s.last = now; s.active_ms = Math.max(s.active_ms, active); s.max_scroll = Math.max(s.max_scroll, scroll); s.used_live = Math.max(s.used_live, live); }
  }
}

export function recordEvent(body) {
  const now = Date.now();
  const name = String(body.event || '').slice(0, 40);
  if (!name) return;
  const sid = String(body.sid || '').slice(0, 64), vid = String(body.vid || '').slice(0, 64);
  const meta = JSON.stringify(body.meta || {}).slice(0, 500);
  if (name === 'live_on') recordPulse({ sid, live: 1, activeMs: 0, maxScroll: 0 });
  if (db) db.prepare('INSERT INTO events(ts,sid,vid,name,meta) VALUES(?,?,?,?,?)').run(now, sid, vid, name, meta);
  else { mem.events.push({ ts: now, sid, vid, name, meta }); if (mem.events.length > 50000) mem.events.shift(); }
}

const all = () => db
  ? db.prepare('SELECT * FROM sessions WHERE bot=0').all().map(r => ({ ...r, returning: r.is_returning }))
  : [...mem.sessions.values()].filter(s => !s.bot);

export function stats() {
  const now = Date.now();
  const rows = all();
  const since = ms => rows.filter(r => r.started >= now - ms);
  const uniq = arr => new Set(arr.map(r => r.vid || r.ip_hash)).size;

  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const today = rows.filter(r => r.started >= +startOfDay);
  const online = rows.filter(r => r.last >= now - 60e3);

  const top = (key, list, n = 10) => {
    const m = new Map();
    for (const r of list) { const k = r[key] || '(ישיר)'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
  };
  const avg = (list, key) => list.length ? Math.round(list.reduce((s, r) => s + (r[key] || 0), 0) / list.length) : 0;

  // גרף 24 שעות אחרונות לפי שעה
  const hourly = Array.from({ length: 24 }, (_, i) => {
    const from = now - (23 - i) * 3600e3, to = from + 3600e3;
    const b = rows.filter(r => r.started >= from && r.started < to);
    return { hour: new Date(from).getHours(), sessions: b.length, visitors: uniq(b) };
  });
  const daily = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (29 - i));
    const from = +d, to = from + 86400e3;
    const b = rows.filter(r => r.started >= from && r.started < to);
    return { date: d.toISOString().slice(0, 10), sessions: b.length, visitors: uniq(b) };
  });

  return {
    now,
    online: { sessions: online.length, visitors: uniq(online), live: online.filter(r => r.used_live).length },
    totals: {
      allTimeSessions: rows.length, allTimeVisitors: uniq(rows),
      today: today.length, todayVisitors: uniq(today),
      last24h: since(86400e3).length, last7d: since(7 * 86400e3).length, last30d: since(30 * 86400e3).length
    },
    engagement: {
      avgActiveSec: Math.round(avg(today, 'active_ms') / 1000),
      avgScroll: avg(today, 'max_scroll'),
      returningPct: today.length ? Math.round(today.filter(r => r.returning).length / today.length * 100) : 0,
      liveUsersToday: today.filter(r => r.used_live).length,
      bounce: today.length ? Math.round(today.filter(r => (r.active_ms || 0) < 15000).length / today.length * 100) : 0
    },
    breakdown: {
      referrers: top('ref_host', rows.filter(r => r.started >= now - 30 * 86400e3)),
      devices: top('device', rows), os: top('os', rows), browsers: top('browser', rows),
      campaigns: top('utm_campaign', rows.filter(r => r.utm_campaign)),
      sources: top('utm_source', rows.filter(r => r.utm_source)),
      countries: top('country', rows.filter(r => r.country))
    },
    hourly, daily,
    bots: db ? db.prepare('SELECT COUNT(*) c FROM sessions WHERE bot=1').get().c : 0,
    storage: db ? 'sqlite' : 'memory'
  };
}

export function liveFeed(limit = 40) {
  const rows = all().sort((a, b) => b.last - a.last).slice(0, limit);
  return rows.map(r => ({
    at: r.started, last: r.last, device: r.device, os: r.os, browser: r.browser,
    ref: r.ref_host || '(ישיר)', activeSec: Math.round((r.active_ms || 0) / 1000),
    scroll: r.max_scroll, live: !!r.used_live, returning: !!r.returning, country: r.country || ''
  }));
}

// צפיות/קליקים בפרסומות ושיתופים: היום, 7 ימים, ומאז ההתחלה
export function adStats() {
  const now = Date.now();
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const rows = db
    ? db.prepare("SELECT ts,name,meta FROM events WHERE name IN ('ad_view','ad_click','ad_close','share_whatsapp')").all()
    : mem.events.filter(e => ['ad_view', 'ad_click', 'ad_close', 'share_whatsapp'].includes(e.name));
  const out = {};
  const bucket = k => (out[k] ||= { closes: 0, views: 0, clicks: 0, viewsToday: 0, clicksToday: 0, views7d: 0, clicks7d: 0 });
  for (const r of rows) {
    let ad = 'share';
    if (r.name !== 'share_whatsapp') { try { ad = String(JSON.parse(r.meta).ad || '?').slice(0, 20); } catch { ad = '?'; } }
    const b = bucket(ad);
    if (r.name === 'ad_close') { b.closes++; continue; }
    const kind = r.name === 'ad_view' ? 'views' : 'clicks';
    b[kind]++;
    if (r.ts >= +d0) b[kind + 'Today']++;
    if (r.ts >= now - 7 * 86400e3) b[kind + '7d']++;
  }
  return out;
}
