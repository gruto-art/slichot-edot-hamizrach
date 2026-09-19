/* סליחות עדות המזרח — לוגיקת צד לקוח: מעקב חי, קריאה, ומדידת כניסות */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  };

  /* ---------- ערכת נושא ---------- */
  const themeBtn = $('#themeBtn');
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme:dark)').matches);
    if (themeBtn) themeBtn.textContent = dark ? 'מצב יום' : 'מצב לילה';
  }
  applyTheme(store.get('theme', 'auto'));
  themeBtn?.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme:dark)').matches);
    const next = dark ? 'light' : 'dark';
    store.set('theme', next); applyTheme(next);
  });

  /* ---------- גודל גופן ---------- */
  let fs = parseFloat(store.get('fontSize', '1.15'));
  const setFs = v => {
    fs = Math.min(2.4, Math.max(0.9, Math.round(v * 100) / 100));
    document.documentElement.style.setProperty('--reading', fs + 'rem');
    store.set('fontSize', fs);
  };
  setFs(fs);
  $('#fontPlus')?.addEventListener('click', () => setFs(fs + 0.1));
  $('#fontMinus')?.addEventListener('click', () => setFs(fs - 0.1));

  /* ---------- מעקב חי אחרי הכותל ---------- */
  const liveBtn = $('#liveBtn'), panel = $('#livePanel'), statusEl = $('#liveStatus');
  const words = Array.from(document.querySelectorAll('w[data-i]'));
  const byIndex = new Map(words.map(w => [+w.dataset.i, w]));
  let es = null, live = false, cur = -1, userScrolledAt = 0, lastEventAt = 0;

  // זיהוי גלילה יזומה של המשתמש (ולא של המעקב עצמו) — לפי אירועי קלט בלבד
  const userMoved = () => { if (live) userScrolledAt = Date.now(); };
  addEventListener('wheel', userMoved, { passive: true });
  addEventListener('touchmove', userMoved, { passive: true });
  addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) userMoved();
  }, { passive: true });

  function paint(i) {
    if (i === cur) return;
    const prev = byIndex.get(cur); if (prev) prev.classList.remove('now');
    const el = byIndex.get(i);
    if (!el) return;
    // סימון מה שכבר נאמר
    if (i > cur) { for (let k = Math.max(0, cur); k < i; k++) byIndex.get(k)?.classList.add('past'); }
    else { for (let k = i; k <= cur; k++) byIndex.get(k)?.classList.remove('past'); }
    cur = i;
    el.classList.add('now');
    if (Date.now() - userScrolledAt < 12000) return;   // אחרי גלילה ידנית — 12 שניות של כבוד למשתמש
    const rect = el.getBoundingClientRect();
    const target = innerHeight * 0.4;
    const delta = rect.top - target;
    if (Math.abs(delta) < 60) return;
    // קפיצה רחוקה: מיידית. תזוזה קרובה: חלקה.
    const behavior = Math.abs(delta) > innerHeight * 2 ? 'auto' : 'smooth';
    const before = scrollY;
    scrollTo({ top: before + delta, behavior });
    // גיבוי: בדפדפנים/מצבים שבהם scrollTo אינו נענה
    setTimeout(() => {
      if (Math.abs(scrollY - before) < 4) {
        try { el.scrollIntoView({ block: 'center', behavior }); } catch { el.scrollIntoView(); }
      }
    }, 60);
  }

  function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }

  // חזרה ללשונית: דפדפנים אינם גוללים לשונית מוסתרת — מיישרים את המיקום מחדש
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && live && cur >= 0) {
      const el = byIndex.get(cur);
      if (el) setTimeout(() => { try { el.scrollIntoView({ block: 'center' }); } catch {} }, 120);
    }
  });

  function connect() {
    es = new EventSource('/api/live/stream');
    es.addEventListener('position', e => {
      lastEventAt = Date.now();
      const d = JSON.parse(e.data);
      if (typeof d.word === 'number') paint(d.word);
      const conf = d.confidence != null ? Math.round(d.confidence * 100) + '%' : '—';
      setStatus(`מסונכרן עם הכותל · <strong>${d.section || ''}</strong> · דיוק זיהוי ${conf}` +
        (d.mode === 'manual' ? ' · סנכרון ידני' : d.mode === 'drift' ? ' · המשך משוער' : ''));
    });
    es.addEventListener('status', e => {
      const d = JSON.parse(e.data);
      if (d.state === 'idle') setStatus('אין כרגע שידור סליחות חי מהכותל. אפשר לקרוא בקצב שלך — המעקב יופעל כשהשידור יתחיל.');
      else if (d.state === 'starting') setStatus('מתחבר לשידור החי מהכותל ומאזין לחזן…');
      else if (d.state === 'listening') setStatus('מאזין לשידור מהכותל, מחפש את המקום…');
      else if (d.message) setStatus(d.message);
    });
    es.onerror = () => { if (live) setStatus('החיבור נקטע — מנסה שוב…'); };
  }

  function stop() {
    live = false; es?.close(); es = null;
    liveBtn?.setAttribute('aria-pressed', 'false');
    liveBtn?.classList.remove('on');
    panel?.classList.remove('show');
    byIndex.get(cur)?.classList.remove('now');
    document.querySelectorAll('w.past').forEach(w => w.classList.remove('past'));
    cur = -1;
  }

  liveBtn?.addEventListener('click', () => {
    if (live) { stop(); track('live_off'); return; }
    live = true;
    liveBtn.setAttribute('aria-pressed', 'true');
    liveBtn.classList.add('on');
    panel?.classList.add('show');
    setStatus('מתחבר לשידור מהכותל…');
    connect();
    track('live_on');
  });
  $('#liveClose')?.addEventListener('click', stop);

  /* ---------- מדידת כניסות מדויקת ---------- */
  const vid = (() => {
    let v = store.get('v_id', '');
    if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); store.set('v_id', v); }
    return v;
  })();
  const sid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  const firstSeen = store.get('v_first', '');
  if (!firstSeen) store.set('v_first', new Date().toISOString());
  const q = new URLSearchParams(location.search);
  let maxScroll = 0, activeMs = 0, lastTick = Date.now(), visible = !document.hidden;

  function send(url, data, beacon) {
    const body = JSON.stringify(data);
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon(url, new Blob([body], { type: 'application/json' })); return; }
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }
  function track(event, extra) { send('/api/event', { vid, sid, event, ...extra }); }

  send('/api/hit', {
    vid, sid, path: location.pathname, ref: document.referrer || '',
    returning: !!firstSeen, firstSeen: firstSeen || new Date().toISOString(),
    utm: { source: q.get('utm_source') || '', medium: q.get('utm_medium') || '', campaign: q.get('utm_campaign') || '' },
    screen: innerWidth + 'x' + innerHeight, dpr: devicePixelRatio || 1,
    lang: navigator.language || '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    ua: navigator.userAgent
  });

  // פרסומות: צפייה נספרת פעם אחת לעמוד, כשחצי מהבאנר נראה שנייה לפחות. הקליק נספר בשרת (/go/:id).
  // Google Analytics 4: אירועי קידום מכירות הסטנדרטיים (view_promotion / select_promotion) ו-share
  const ga = (name, params) => { try { if (typeof window.gtag === 'function') window.gtag('event', name, params); } catch {} };
  const promo = a => ({ promotion_id: a.dataset.ad, promotion_name: a.dataset.adName, creative_slot: a.dataset.adSlot });
  document.querySelectorAll('a[data-ad]').forEach(a => {
    a.href = '/go/' + a.dataset.ad + '?s=' + encodeURIComponent(sid);
    a.addEventListener('click', () => ga('select_promotion', promo(a)));
  });
  if ('IntersectionObserver' in window) {
    const seen = new Set(), timers = new Map();
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      const id = e.target.dataset.ad;
      if (seen.has(id)) return;
      if (e.isIntersecting) timers.set(id, setTimeout(() => { seen.add(id); io.unobserve(e.target); track('ad_view', { meta: { ad: id } }); ga('view_promotion', promo(e.target)); }, 1000));
      else clearTimeout(timers.get(id));
    }), { threshold: 0.5 });
    document.querySelectorAll('a[data-ad]').forEach(a => io.observe(a));
  }
  // החלפת מסכים בבאנרים: כל באנר בקצב שלו (data-fs). הסרת .on והחזרתה מפעילה מחדש את הנפשת הכניסה.
  // לא מחליפים כשהלשונית מוסתרת או כשהבאנר הוסתר — חוסך מעבד בטלפון.
  document.querySelectorAll('.had').forEach(a => {
    const frames = [...a.querySelectorAll('.af')];
    if (frames.length < 2) return;
    let i = 0;
    setInterval(() => {
      if (document.hidden || a.closest('.ad-hidden')) return;
      frames[i].classList.remove('on');
      i = (i + 1) % frames.length;
      frames[i].classList.add('on');
    }, (Number(a.dataset.fs) || 3) * 1000);
  });

  // הסתרת פרסומת: הכפתור מופיע אחרי 30 שניות, ההסתרה נשמרת ל-5 דקות (גם ברענון)
  const AD_SHOW_CLOSE_MS = 30e3, AD_HIDE_MS = 5 * 60e3;
  document.querySelectorAll('.ad[data-slot]').forEach(box => {
    const key = 'adHidden_' + box.dataset.slot, x = box.querySelector('.ad-x');
    if (!x) return;
    const show = () => { box.classList.remove('ad-hidden'); x.hidden = true; setTimeout(() => { x.hidden = false; }, AD_SHOW_CLOSE_MS); };
    const hideFor = ms => { box.classList.add('ad-hidden'); setTimeout(show, ms); };
    const until = Number(store.get(key, 0)) || 0;
    if (until > Date.now()) hideFor(until - Date.now()); else show();
    x.addEventListener('click', () => {
      store.set(key, Date.now() + AD_HIDE_MS);
      const a = box.querySelector('[data-ad]');
      track('ad_close', { meta: { ad: a?.dataset.ad || box.dataset.slot } });
      if (a) ga('ad_close', promo(a));
      hideFor(AD_HIDE_MS);
    });
  });

  const wa = document.getElementById('waShare');
  if (wa) wa.addEventListener('click', () => { track('share_whatsapp'); ga('share', { method: 'whatsapp', content_type: 'website', item_id: location.pathname }); });

  addEventListener('scroll', () => {
    const h = document.body.scrollHeight - innerHeight;
    if (h > 0) maxScroll = Math.max(maxScroll, Math.min(100, Math.round((scrollY / h) * 100)));
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    if (visible) activeMs += now - lastTick;
    visible = !document.hidden; lastTick = now;
  });

  setInterval(() => {
    const now = Date.now();
    if (visible) { activeMs += now - lastTick; }
    lastTick = now;
    send('/api/pulse', { vid, sid, activeMs, maxScroll, live });
  }, 15000);

  addEventListener('pagehide', () => {
    if (visible) activeMs += Date.now() - lastTick;
    send('/api/leave', { vid, sid, activeMs, maxScroll, live }, true);
  });
})();
