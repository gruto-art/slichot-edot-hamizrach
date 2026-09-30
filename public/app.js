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
  const posOf = new Map(words.map((w, k) => [+w.dataset.i, k]));
  let es = null, live = false, cur = -1, userScrolledAt = 0, lastEventAt = 0;
  const READ_LINE = 0.4;   // שורת הקריאה: 40% מגובה המסך — שם המעקב מציב את המילה, ומשם נמדד מקום הקורא

  /** המילה שנמצאת עכשיו בשורת הקריאה (חיפוש בינארי — המילים מסודרות לפי סדר הדף) */
  function wordAtLine() {
    if (!words.length) return -1;
    const y = innerHeight * READ_LINE;
    let lo = 0, hi = words.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (words[mid].getBoundingClientRect().top <= y) lo = mid; else hi = mid - 1;
    }
    return +words[lo].dataset.i;
  }

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

  /* צביעה "נקראת": כשהחזן או הקהל מובילים, המילים נצבעות אחת-אחת עד המקום החדש, בקצב קריאה
     שמאיץ לפי הפער — ולא קפיצה של כל הדף. חזרה לאחור או קפיצה רחוקה (פרק אחר) — מיידית. */
  let target = -1, animT = null;
  function goTo(i, smooth) {
    target = i;
    if (!smooth || cur < 0 || i <= cur || !posOf.has(i) || posOf.get(i) - posOf.get(cur) > 250) {
      clearTimeout(animT); animT = null; paint(i); return;
    }
    if (!animT) stepRead();
  }
  function stepRead() {
    animT = null;
    const from = posOf.get(cur), to = posOf.get(target);
    if (from == null || to == null || to <= from) return;
    paint(+words[from + 1].dataset.i);
    const gap = to - from - 1;
    if (gap > 0) animT = setTimeout(stepRead, 1000 / Math.max(3.5, gap / 1.2));
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
      const led = d.mode === 'manual' || d.mode === 'crowd';
      if (typeof d.word === 'number') goTo(d.word, led);
      const conf = d.confidence != null ? Math.round(d.confidence * 100) + '%' : '—';
      if (d.mode === 'manual') setStatus(`עוקב אחרי החזן · <strong>${d.section || ''}</strong>`);
      else if (d.mode === 'crowd') setStatus(`עוקב אחרי רוב הקהל · <strong>${d.section || ''}</strong>`);
      else setStatus(`מסונכרן עם הכותל · <strong>${d.section || ''}</strong> · דיוק זיהוי ${conf}` +
        (d.mode === 'drift' ? ' · המשך משוער' : ''));
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
    clearTimeout(animT); animT = null; target = -1;
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

  /* ---------- מצב "רוב הקהל": כל קורא פעיל מדווח היכן הוא אוחז ----------
     נספר רק מי שקורא בעצמו עכשיו: הלשונית גלויה, נגע בדף בשתי הדקות האחרונות,
     ואינו נגרר כרגע על ידי המעקב (אחרת הקהל היה עוקב אחרי עצמו ולא זז).
     כשהמצב כבוי השרת עונה want=false, והדפדפן בודק שוב רק פעם בדקה. */
  let touchedAt = 0, leading = false;
  const touched = () => { touchedAt = Date.now(); };
  ['wheel', 'touchmove', 'scroll', 'keydown'].forEach(ev => addEventListener(ev, touched, { passive: true }));
  function vote() {
    let next = 60000;
    const reading = !document.hidden && Date.now() - touchedAt < 120000 && !leading
      && (!live || Date.now() - userScrolledAt < 12000);
    const word = reading ? wordAtLine() : -1;
    fetch('/api/live/pos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid, word }) })
      .then(r => r.json()).then(d => { if (d.want) next = 6000; }).catch(() => {})
      .finally(() => setTimeout(vote, next));
  }
  if (words.length) setTimeout(vote, 4000);

  /* ---------- פס המנהל: מי מוביל את הדף, והובלה בגלילה מהמכשיר הזה ----------
     מופיע רק במכשיר שנכנס ללוח הבקרה (הטוקן שמור בו) ורק אחרי שהשרת אישר אותו. */
  const adminToken = store.get('admin_token', '');
  if (adminToken && words.length) {
    const api = (url, body) => fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-admin-token': adminToken, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    }).then(r => r.ok ? r.json() : Promise.reject(r.status));
    const bar = document.createElement('div');
    bar.className = 'lead-bar';
    bar.innerHTML = `<span class="lb-t">מוביל הדף:</span>
      <button data-lead="kotel">כותל</button><button data-lead="admin">חזן — אני</button><button data-lead="crowd">רוב הקהל</button>
      <span class="lb-s" id="lbStatus"></span>`;
    const line = document.createElement('div');
    line.className = 'lead-line';
    line.style.top = (READ_LINE * 100) + 'vh';
    let lead = '', lastSent = -1, sendT = null, mark = -1;
    const lbStatus = () => bar.querySelector('#lbStatus');
    function show(d) {
      lead = d.lead;
      bar.querySelectorAll('[data-lead]').forEach(b => b.classList.toggle('on', b.dataset.lead === lead && (lead !== 'admin' || leading)));
      if (lead !== 'admin' && leading) setLeading(false);
      lbStatus().textContent =
        lead === 'crowd' ? `${d.crowd.active} קוראים פעילים${d.crowd.active < d.crowd.needed ? ` — צריך ${d.crowd.needed}, בינתיים לא זז` : ''} · ${d.listeners} עוקבים`
        : lead === 'admin' ? (leading ? `הגלילה שלך מובילה · ${d.listeners} עוקבים` : 'החזן מוביל ממכשיר אחר — לחצו "חזן — אני" כדי להוביל מכאן')
        : `${d.listeners} עוקבים`;
    }
    function setLeading(on) {
      leading = on;
      document.body.classList.toggle('leading', on);
      if (on) { document.body.appendChild(line); if (live) stop(); pushScroll(); }
      else { line.remove(); byIndex.get(mark)?.classList.remove('now'); mark = -1; }
    }
    // הגלילה שלי -> המילה בשורת הקריאה -> לשרת, לכל היותר פעמיים בשנייה
    function pushScroll() {
      if (!leading || sendT) return;
      sendT = setTimeout(() => {
        sendT = null;
        const w = wordAtLine();
        if (w !== mark) { byIndex.get(mark)?.classList.remove('now'); byIndex.get(w)?.classList.add('now'); mark = w; }
        if (w < 0 || w === lastSent) return;
        lastSent = w;
        api('/api/live/manual', { word: w, scroll: 1 }).catch(e => { lbStatus().textContent = e === 401 ? 'הטוקן אינו תקף' : 'שליחה נכשלה — מנסה שוב בגלילה הבאה'; lastSent = -1; });
      }, 450);
    }
    addEventListener('scroll', pushScroll, { passive: true });
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-lead]');
      if (!b) return;
      const want = b.dataset.lead;
      if (want === 'admin') { setLeading(true); lastSent = -1; }
      api('/api/live/lead', { lead: want }).then(d => { show(d); if (want === 'admin') pushScroll(); })
        .catch(() => { lbStatus().textContent = 'השינוי נכשל'; if (want === 'admin') setLeading(false); });
    });
    const poll = () => api('/api/live/lead').then(d => { if (!bar.isConnected) document.body.appendChild(bar); show(d); }).catch(() => {});
    poll(); setInterval(poll, 5000);
  }

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
