// בונה את public/index.html — כל הטקסט מוטמע ב-HTML לצורכי SEO (ללא תלות ב-JS)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADS } from '../server/ads.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doc = JSON.parse(fs.readFileSync(path.join(root, 'data/slichot.json'), 'utf8'));
const SITE = process.env.SITE_URL || 'https://slichot.onrender.com';
const ADSENSE_CLIENT = process.env.ADSENSE_CLIENT || '';
const ADSENSE_SLOT_TOP = process.env.ADSENSE_SLOT_TOP || '';
const ADSENSE_SLOT_BOTTOM = process.env.ADSENSE_SLOT_BOTTOM || '';
const GA_ID = process.env.GA_MEASUREMENT_ID || '';
const GSC_TOKEN = process.env.GOOGLE_SITE_VERIFICATION || '';

const ver = f => {
  try { return String(fs.statSync(path.join(root, 'public', f)).mtimeMs & 0x7fffffff); } catch { return '1'; }
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- עונת הסליחות הקרובה: מחושב בכל בנייה מהלוח העברי של Node (בלי ספרייה) ---------- */
// שנה עברית ותאריך באותיות: 5788 -> תשפ״ח, 1 -> א׳
function gematria(n) {
  const L = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
  let out = '';
  for (const [v, c] of L) while (n >= v) {
    if (n === 15) { out += 'טו'; n = 0; break; }
    if (n === 16) { out += 'טז'; n = 0; break; }
    out += c; n -= v;
  }
  return out.length > 1 ? out.slice(0, -1) + '״' + out.slice(-1) : out + '׳';
}
const hebParts = d => Object.fromEntries(new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  .formatToParts(d).map(p => [p.type, p.value]));
const DAY = 864e5;
function nextSeason(now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let yk = null;
  for (let t = start; t < start + 400 * DAY; t += DAY) {
    const p = hebParts(new Date(t));
    if (p.month === 'Tishri' && p.day === '10') { yk = t; break; }
  }
  const rh = yk - 9 * DAY, elul = rh - 29 * DAY;   // אלול תמיד 29 יום
  const year = Number(hebParts(new Date(yk)).year);
  const greg = t => new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(t));
  return {
    year: gematria(year % 1000), prevYear: gematria((year - 1) % 1000),
    elul: greg(elul), rh: greg(rh), erevYk: greg(yk - DAY), yk: greg(yk),
    elulIso: new Date(elul).toISOString().slice(0, 10), ykIso: new Date(yk).toISOString().slice(0, 10)
  };
}
const SEASON = nextSeason();
// תאריך עדכון התוכן — לעדכן ידנית כשהטקסט או ההסברים משתנים (גוגל מתעלם מ-lastmod שמשתנה בכל הפעלה)
const CONTENT_UPDATED = '2026-09-30';

const TITLE = 'סליחות עדות המזרח — תפילת הסליחות בנוסח ספרדי, מלאה ומנוקדת | מעקב חי מהכותל';
const DESC = 'תפילת הסליחות בנוסח עדות המזרח (ספרדי), הסדר המלא מנוקד ומעומד לקריאה: לך ה׳ הצדקה, י״ג מידות, אשמנו, אדון הסליחות, אבינו מלכנו ושומר ישראל. לכל ימי אלול, לעשרת ימי תשובה ולערב יום כיפור — וכולל מעקב חי אחרי הסליחות בכותל המערבי.';
const KEYWORDS = 'סליחות עדות המזרח, סליחות ספרדי, סליחות ספרדים, תפילת הסליחות, סדר סליחות, סליחות מנוקד, סליחות אלול, סליחות ערב יום כיפור, סליחות עשרת ימי תשובה, סליחות בכותל, סליחות מהכותל בשידור חי, סליחות לאשמורת הבוקר, מתי אומרים סליחות, לך ה׳ הצדקה, י״ג מידות, אדון הסליחות, אשמנו, אבינו מלכנו, שומר ישראל, טקסט סליחות מלא';

// באנר מונפש: 4–5 מסכים מתחלפים בלולאה (CSS בלבד), מסומן "פרסומת", הקליק עובר דרך /go/:id למעקב
function houseAd(id, ad, hidden = false) {
  // המסך הראשון גלוי גם בלי JS; app.js מחליף מסכים ומפעיל מחדש את הנפשת הכניסה של כל אחד
  const frames = ad.frames.map((f, i) => `<span class="af${i ? '' : ' on'}">${f}</span>`).join('');
  // מידות קבועות נגד קפיצת תוכן (CLS); התחתון נטען בעצלות כדי לא לעכב את הטקסט
  const logo = ad.logo ? `<img class="alogo" src="${esc(ad.logo)}" alt="${esc(ad.logoAlt || ad.name)}" width="${ad.logoW || 40}" height="${ad.logoH || 40}" decoding="async"${ad.pos === 'bottom' ? ' loading="lazy"' : ''}>` : '';
  return `<a class="had had-${esc(ad.theme || 'plain')}" href="/go/${esc(id)}" target="_blank" rel="sponsored nofollow noopener" data-ad="${esc(id)}" data-ad-name="${esc(ad.name)}" data-ad-slot="${esc(ad.pos)}" data-fs="${ad.frameSec || 3}" data-cycle="${ad.cycleSec || 15}"${hidden ? ' hidden' : ''} aria-label="${esc(ad.name)} — פרסומת"><span class="deco" aria-hidden="true">${ad.deco || ''}</span>${logo}<span class="afs">${frames}</span><span class="atag">פרסומת</span></a>`;
}

function adBlock(pos, slot) {
  // כמה באנרים באותו מיקום = סבב; הראשון גלוי, השאר מוסתרים עד שתורם מגיע (app.js)
  const house = Object.entries(ADS).filter(([, a]) => a.pos === pos);
  if (house.length) return `<aside class="ad ad-${pos}" aria-label="פרסומת" data-slot="${pos}"><div class="ad-inner">${house.map(([id, a], i) => houseAd(id, a, i > 0)).join('')}<button class="ad-x" type="button" hidden aria-label="הסתרת הפרסומת ל-5 דקות" title="הסתרה ל-5 דקות">×</button></div></aside>`;
  const inner = ADSENSE_CLIENT && slot
    ? `<ins class="adsbygoogle" style="display:block" data-ad-client="${esc(ADSENSE_CLIENT)}" data-ad-slot="${esc(slot)}" data-ad-format="horizontal" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script>`
    : `<div class="ad-ph">שטח פרסום · ${pos === 'top' ? 'עליון' : 'תחתון'}</div>`;
  return `<aside class="ad ad-${pos}" aria-label="פרסומת"><div class="ad-inner">${inner}</div></aside>`;
}

// עימוד סידורי: כל טור (עד סוף־פסוק או נקודה) עומד בשורה נפרדת
function renderWords(words) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (/[:.\u05C3]$/.test(w.t) && cur.length > 1) { lines.push(cur); cur = []; }
  }
  if (cur.length) lines.push(cur);
  return lines.map(line =>
    `<l>${line.map(w => `<w data-i="${w.i}">${esc(w.t)}</w>`).join(' ')}</l>`
  ).join('\n');
}

const body = doc.sections.map(sec => {
  const paras = sec.paragraphs.map(p => {
    const dir = p.dir ? `<i class="dir">(${esc(p.dir)})</i>` : '';
    return `<p data-p="${p.p}">${dir}${renderWords(p.w)}</p>`;
  }).join('\n');
  return `<section class="sec" id="${esc(sec.slug)}" data-sec="${sec.id}">
<h2>${esc(sec.title)}</h2>
<p class="sec-desc">${esc(sec.desc)}</p>
<div class="sec-rule"></div>
<div class="prose">
${paras}
</div>
</section>`;
}).join('\n\n');

const toc = doc.sections.map(s => `<li><a href="#${esc(s.slug)}">${esc(s.title)}</a></li>`).join('');

const plain = doc.sections.slice(0, 6)
  .flatMap(s => s.paragraphs).flatMap(p => p.w).slice(0, 120)
  .map(w => w.t).join(' ');

const FAQ = [
  ['מהן סליחות עדות המזרח?', 'סליחות עדות המזרח הן סדר תפילות הבקשה והרחמים שנוהגים בני עדות המזרח והספרדים לומר מראש חודש אלול ועד יום הכיפורים, באשמורת הבוקר. הסדר כולל את "לך ה׳ הצדקה", "בן אדם מה לך נרדם", י״ג מידות של רחמים, וידוי, "אדון הסליחות", "אבינו מלכנו" ו"שומר ישראל".'],
  [`מתי מתחילים לומר סליחות בשנת ${SEASON.year}?`, `לקראת ראש השנה ${SEASON.year} מתחילים בני עדות המזרח לומר סליחות בא׳ באלול ${SEASON.prevYear} — ${SEASON.elul}. אומרים אותן בכל יום (חוץ משבת) עד ערב יום הכיפורים, ${SEASON.erevYk}. ראש השנה חל ב${SEASON.rh}, ויום הכיפורים ב${SEASON.yk}.`],
  ['מתי מתחילים לומר סליחות בנוסח ספרדי?', 'בני עדות המזרח מתחילים לומר סליחות מראש חודש אלול (א׳ באלול) וממשיכים בכל יום עד יום הכיפורים, בשונה ממנהג אשכנז שמתחיל במוצאי השבת שלפני ראש השנה.'],
  ['באיזו שעה אומרים סליחות?', 'המנהג המקורי הוא לומר סליחות באשמורת הבוקר, בשליש האחרון של הלילה לפני עלות השחר — שעת רצון מיוחדת, כמו שנאמר "קמתי באשמורת לבקש על עווני".'],
  ['מה זה מעקב חי אחרי הסליחות בכותל?', 'תכונה באתר שמסנכרנת את הטקסט עם השידור החי של הסליחות מהכותל המערבי: מערכת תמלול בזמן אמת מזהה היכן אוחז החזן, והאתר גולל ומדגיש את המילים המדויקות שנאמרות באותו רגע.'],
  ['האם אומרים סליחות בערב יום כיפור?', 'כן. ערב יום הכיפורים הוא היום שבו מרבים בסליחות יותר מכל ימות השנה, ובקהילות רבות משכימים אליו במיוחד. בעשרת ימי תשובה ובערב יום כיפור מוסיפים בסליחות קטעים שאינם נאמרים בשאר הימים, ובהם ״למענך אלהי״, ״רחמנא כתבינן בספרא דחיי טבי״ ו״ובספר חיים זכרנו וכתבנו״. באתר זה כל התוספות מסומנות בהוראה שלפניהן.'],
  ['האם הטקסט מנוקד?', 'כן. כל סדר הסליחות באתר מנוקד ניקוד מלא ומעומד בפריסה נוחה לקריאה, גם במסך הטלפון וגם במחשב, עם אפשרות להגדלת הגופן ומצב לילה.']
];

const jsonld = [
  {
    '@context': 'https://schema.org', '@type': 'WebSite', '@id': SITE + '/#website',
    name: 'סליחות עדות המזרח', alternateName: 'סליחות ספרדי', url: SITE, inLanguage: 'he',
    description: DESC,
    potentialAction: { '@type': 'ReadAction', target: SITE }
  },
  {
    '@context': 'https://schema.org', '@type': 'Book', '@id': SITE + '/#slichot',
    name: 'סליחות נוסח עדות המזרח', dateModified: CONTENT_UPDATED, isPartOf: { '@id': SITE + '/#website' },
    hasPart: doc.sections.map(sec => ({ '@type': 'Chapter', name: sec.title, url: `${SITE}/#${sec.slug}` })), alternateName: ['סליחות ספרדים', 'סדר סליחות עדות המזרח'],
    inLanguage: 'he', bookFormat: 'https://schema.org/EBook', isAccessibleForFree: true,
    url: SITE, about: 'סדר הסליחות לחודש אלול ולעשרת ימי תשובה במנהג עדות המזרח',
    genre: 'ליטורגיה יהודית', abstract: plain.slice(0, 500),
    publisher: { '@type': 'Organization', name: 'סליחות עדות המזרח', url: SITE }
  },
  {
    '@context': 'https://schema.org', '@type': 'Event', name: `סליחות עדות המזרח — עונת ${SEASON.year}`,
    description: `אמירת סליחות בנוסח עדות המזרח מא׳ באלול ועד ערב יום הכיפורים ${SEASON.year}, באשמורת הבוקר.`,
    startDate: SEASON.elulIso, endDate: SEASON.ykIso, eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/MixedEventAttendanceMode', inLanguage: 'he', isAccessibleForFree: true,
    location: [
      { '@type': 'VirtualLocation', url: SITE },
      { '@type': 'Place', name: 'הכותל המערבי', address: { '@type': 'PostalAddress', addressLocality: 'ירושלים', addressCountry: 'IL' } }
    ],
    organizer: { '@type': 'Organization', name: 'סליחות עדות המזרח', url: SITE }
  },
  {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
  }
];

const ga = GA_ID ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(GA_ID)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(GA_ID)}');</script>` : '';
const adsHead = ADSENSE_CLIENT ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(ADSENSE_CLIENT)}" crossorigin="anonymous"></script>` : '';

const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(DESC)}">
<meta name="keywords" content="${esc(KEYWORDS)}">
<meta name="author" content="סליחות עדות המזרח">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
${GSC_TOKEN ? `<meta name="google-site-verification" content="${esc(GSC_TOKEN)}">` : ''}
<link rel="canonical" href="${SITE}/">
<meta property="og:type" content="website">
<meta property="og:locale" content="he_IL">
<meta property="og:site_name" content="סליחות עדות המזרח">
<meta property="og:title" content="${esc(TITLE)}">
<meta property="og:description" content="${esc(DESC)}">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(TITLE)}">
<meta name="twitter:description" content="${esc(DESC)}">
<meta name="theme-color" content="#f7f2e7" media="(prefers-color-scheme:light)">
<meta name="theme-color" content="#100e0b" media="(prefers-color-scheme:dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700;900&family=Noto+Serif+Hebrew:wght@400;500;600&family=Rubik:wght@500;800&family=Bellefair&family=Great+Vibes&display=swap">
<link rel="stylesheet" href="/style.css?v=${ver('style.css')}">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
${adsHead}${ga}
</head>
<body>
${adBlock('top', ADSENSE_SLOT_TOP)}

<nav class="toolbar" aria-label="כלי קריאה">
  <div class="toolbar-inner">
    <button class="btn btn-live" id="liveBtn" aria-pressed="false" title="סנכרון הטקסט עם השידור החי מהכותל">
      <span class="live-dot"></span> מעקב אחרי הכותל
    </button>
    <button class="btn" id="fontMinus" title="הקטנת גופן" aria-label="הקטנת גופן">א−</button>
    <button class="btn" id="fontPlus" title="הגדלת גופן" aria-label="הגדלת גופן">א+</button>
    <span class="spacer"></span>
    <a class="btn" href="/hatarat-kelalot" title="התרת נדרים וקללות — נוסח עדות המזרח (ללא מעקב חי)">התרת קללות</a>
    <span class="share-trio" role="group" aria-label="שיתוף האתר">
      <a class="sh sh-wa" id="waShare" href="https://wa.me/?text=${encodeURIComponent('סליחות עדות המזרח — הסדר המלא, מנוקד, עם מעקב חי מהכותל 🙏\n' + SITE + '/?utm_source=whatsapp&utm_medium=share')}" target="_blank" rel="noopener" title="שיתוף בוואטסאפ" aria-label="שיתוף בוואטסאפ"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2.1.7 2.8.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg></a>
      <button class="sh sh-more" id="nativeShare" type="button" hidden title="שיתוף לאינסטגרם, טלגרם ועוד" aria-label="שיתוף לאינסטגרם, טלגרם ועוד"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg></button>
      <button class="sh sh-link" id="copyLink" type="button" title="העתקת קישור לאתר" aria-label="העתקת קישור לאתר"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg></button>
      <span class="sh-toast" id="shareToast" role="status" aria-live="polite"></span>
    </span>
    <button class="btn" id="themeBtn" title="מצב יום / לילה" aria-label="החלפת ערכת צבעים">מצב לילה</button>
  </div>
</nav>

<header class="masthead">
  <h1 class="h1-big">סְלִיחוֹת<span class="sub">נוסח הכותל — סדר מלא ומנוקד</span></h1>
  <div class="ornament"><span>✦</span></div>
  <p class="lede">כל סדר <strong>סליחות עדות המזרח</strong> — מנוקד ניקוד מלא ומעומד לקריאה, מ״אשרי״ ועד ״שומר ישראל״. ובנוסף: מעקב חי שגולל את המילים לפי מה שאומרים ברגע זה בכותל המערבי.</p>
</header>

<main>
  <p class="season-note"><strong>סליחות ${SEASON.year}:</strong> מתחילים בא׳ באלול — ${SEASON.elul}, ואומרים עד ערב יום הכיפורים, ${SEASON.erevYk}.</p>
  <details class="toc">
    <summary>סדר הסליחות — תוכן העניינים (${doc.sections.length} פרקים)</summary>
    <ol>${toc}</ol>
  </details>

  <article id="slichot" class="tracking">
${body}
  </article>

  <section class="seo-block">
    <h2>תפילת הסליחות — מה אומרים ובאיזה סדר</h2>
    <p><strong>תפילת הסליחות</strong> פותחת ב״אשרי יושבי ביתך״ ובחצי קדיש, ומשם עוברת לגוף הסליחות: ״לך ה׳ הצדקה״, פיוטי היום, ואמירות ״אל מלך יושב על כסא רחמים״ עם <strong>שלוש עשרה מידות של רחמים</strong> החוזרות ביניהן. אחריהן באים הווידוי ו״אשמנו״, בקשות ״אלהינו שבשמים״, ״עננו״, ״אדון הסליחות״, ״עשה למען שמך״, ״אבינו מלכנו״ ו״שומר ישראל״, והסדר נחתם בשיר המעלות ממעמקים ובקדיש. כל הסדר מובא כאן במלואו, מנוקד, לפי הסדר שבו אומרים אותו בפועל.</p>

    <h2>סליחות ספרדי — במה נבדל נוסח עדות המזרח</h2>
    <p><strong>סליחות בנוסח ספרדי</strong> — הוא נוסח עדות המזרח — נבדל מנוסח אשכנז בשניים. הראשון הוא מועד ההתחלה: בני עדות המזרח מתחילים <strong>מראש חודש אלול</strong> ואומרים סליחות ארבעים יום רצופים, כנגד ארבעים הימים ששהה משה רבנו בהר סיני עד שנתרצה הקדוש ברוך הוא לישראל ביום הכיפורים; ואילו במנהג אשכנז מתחילים ב<strong>מוצאי השבת</strong> שלפני ראש השנה. השני הוא הפיוטים עצמם: לנוסח הספרדי סדר קבוע לכל הימים, ובו קטעים שאינם במנהג אשכנז כלל — כגון בקשות ״רחמנא״ בארמית וסדרת ״אלהינו שבשמים״.</p>
    <h2>סליחות לערב יום כיפור ולעשרת ימי תשובה</h2>
    <p>בעשרת ימי תשובה ובערב יום הכיפורים הסליחות ארוכות יותר: מוסיפים בהן קטעים שנאמרים רק בימים אלה — ״למענך אלהי״, ״רחמנא כתבינן בספרא דחיי טבי״, ״אלהינו שבשמים כתבנו בספר חיים״ ו״ה׳ חננו והקימנו... ובספר חיים זכרנו וכתבנו״. כל התוספות האלה מסומנות בסדר שלפניכם בהוראה שלפניהן, כדי שיהיה ברור מתי אומרים אותן ומתי מדלגים. ערב יום כיפור הוא היום שבו מרבים בסליחות יותר מכל, ובקהילות רבות משכימים אליו במיוחד.</p>

    <h3>מהו הזמן הראוי לאמירת סליחות?</h3>
    <p>הזמן המובחר לאמירת הסליחות בנוסח עדות המזרח הוא באשמורת הבוקר — השליש האחרון של הלילה, לפני עלות השחר, שעה שהיא עת רצון. על שעה זו נאמר ״קָמְתִּי בְּאַשְׁמוֹרֶת לְבַקֵּשׁ עַל עֲוֹנִי״, ומכאן שמה של אשמורת הסליחות.</p>
    <h3>מה כולל הסדר שבאתר זה?</h3>
    <p>הסדר המלא שלפניכם כולל: אשרי וחצי קדיש, ״בן אדם מה לך נרדם״, ״לך ה׳ הצדקה״, ״למענך אלהי״, הפיוטים ״שבט יהודה״ ו״אנשי אמונה אבדו״, ״אל מלך יושב על כסא רחמים״ עם שלוש עשרה מידות של רחמים (״ויעבור״), בקשות ה״רחמנא״, סדר הווידוי ו״אשמנו״, ״שמע ישראל״, ״ה׳ מלך״, ״אלהינו שבשמים״, ״עננו״, ״אדון הסליחות״, ״אל אדיר שמך״, ״ה׳ עשה למען שמך״, ״חמול על עמך״, ״אבינו מלכנו״, ״שומר ישראל״, ״שיר המעלות ממעמקים״ וקדיש.</p>
    <h2>סליחות בכותל המערבי — מעקב חי</h2>
    <p>לחיצה על ״מעקב אחרי הכותל״ מפעילה סנכרון בזמן אמת: מערכת תמלול מאזינה לשידור החי של הסליחות מרחבת הכותל המערבי, מזהה את המילים הנאמרות ומצליבה אותן מול הטקסט שבאתר. התוצאה — הדף גולל אוטומטית ומדגיש בדיוק את המילה שאומר החזן ברגע זה, כך שאפשר להצטרף לסליחות מכל מקום בעולם בלי לאבד את המקום.</p>
    <h3>נגישות וקריאה</h3>
    <p>הטקסט מעומד בגופן מכובד עם ריווח שורות מוגדל, כדי שהניקוד יישאר קריא גם במסך קטן. אפשר להגדיל ולהקטין את הגופן, ולעבור למצב לילה — נוח במיוחד לאמירת סליחות בשעות הלילה והאשמורת.</p>
    <h2>שאלות ותשובות על הסליחות</h2>
${FAQ.map(([q, a]) => `    <h3>${esc(q)}</h3>\n    <p>${esc(a)}</p>`).join('\n')}
    <p style="font-size:.85rem;margin-top:1.6rem">עודכן: ${CONTENT_UPDATED.split('-').reverse().join('.')} · מקור הטקסט: <a href="${esc(doc.sourceUrl)}" rel="noopener" target="_blank">${esc(doc.source)}</a>. ייתכנו הבדלי נוסח בין קהילות; יש לנהוג כמנהג המקום.</p>
  </section>
</main>

<div class="live-panel" id="livePanel">
  <div class="live-card">
    <span class="live-dot"></span>
    <span class="st" id="liveStatus">מתחבר לשידור מהכותל…</span>
    <button class="x" id="liveClose" aria-label="סגירה">×</button>
  </div>
</div>

<footer>
  <p><strong>סליחות עדות המזרח</strong> — הסדר המלא, מנוקד, בחינם.</p>
  <p>שיהיו כל התפילות עולות לרצון · כתיבה וחתימה טובה</p>
</footer>

${adBlock('bottom', ADSENSE_SLOT_BOTTOM)}
<script src="/app.js?v=${ver('app.js')}" defer></script>
</body>
</html>`;

fs.writeFileSync(path.join(root, 'public/index.html'), html);

/* ---------- דף נפרד: התרת נדרים וקללות (ללא מעקב חי) ---------- */
const hk = JSON.parse(fs.readFileSync(path.join(root, 'data/hatarat_kelalot.json'), 'utf8'));
const HK_TITLE = 'התרת קללות ונדרים — נוסח עדות המזרח, מנוקד | לערב יום כיפור';
const HK_DESC = 'נוסח התרת קללות והתרת נדרים של עדות המזרח (ספרדי), מנוקד ומלא: "שמעו נא רבותינו", מסירת מודעה, והתרת קללות מהחיד"א. לערב ראש השנה ולערב יום כיפור.';
const hkBody = hk.paragraphs.map(p => p.dir
  ? `<p class="hk-dir"><i class="dir">(${esc(p.t)})</i></p>`
  : `<p>${esc(p.t)}</p>`).join('\n');
const hkHtml = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(HK_TITLE)}</title>
<meta name="description" content="${esc(HK_DESC)}">
<meta name="robots" content="index,follow,max-snippet:-1">
<link rel="canonical" href="${SITE}/hatarat-kelalot">
<meta property="og:type" content="article">
<meta property="og:locale" content="he_IL">
<meta property="og:site_name" content="סליחות עדות המזרח">
<meta property="og:title" content="${esc(HK_TITLE)}">
<meta property="og:description" content="${esc(HK_DESC)}">
<meta property="og:url" content="${SITE}/hatarat-kelalot">
<meta property="og:image" content="${SITE}/og.png">
<meta name="theme-color" content="#f7f2e7" media="(prefers-color-scheme:light)">
<meta name="theme-color" content="#100e0b" media="(prefers-color-scheme:dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700;900&family=Noto+Serif+Hebrew:wght@400;500;600&family=Rubik:wght@500;800&family=Bellefair&family=Great+Vibes&display=swap">
<link rel="stylesheet" href="/style.css?v=${ver('style.css')}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify([
  { '@context': 'https://schema.org', '@type': 'Article', headline: HK_TITLE, description: HK_DESC, inLanguage: 'he', url: SITE + '/hatarat-kelalot',
    dateModified: CONTENT_UPDATED, isPartOf: { '@id': SITE + '/#website' }, publisher: { '@type': 'Organization', name: 'סליחות עדות המזרח', url: SITE } },
  { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'סליחות עדות המזרח', item: SITE + '/' },
    { '@type': 'ListItem', position: 2, name: 'התרת קללות ונדרים', item: SITE + '/hatarat-kelalot' }] }
])}</script>
${ga}
</head>
<body>
${adBlock('top', ADSENSE_SLOT_TOP)}
<nav class="toolbar" aria-label="כלי קריאה">
  <div class="toolbar-inner">
    <a class="btn" href="/">→ חזרה לסליחות</a>
    <button class="btn" id="fontMinus" title="הקטנת גופן" aria-label="הקטנת גופן">א−</button>
    <button class="btn" id="fontPlus" title="הגדלת גופן" aria-label="הגדלת גופן">א+</button>
    <span class="spacer"></span>
    <button class="btn" id="themeBtn" title="מצב יום / לילה" aria-label="החלפת ערכת צבעים">מצב לילה</button>
  </div>
</nav>
<header class="masthead">
  <p class="kicker">עֶרֶב יוֹם הַכִּפּוּרִים</p>
  <h1>הַתָּרַת קְלָלוֹת<span class="sub">ונדרים — נוסח עדות המזרח</span></h1>
  <div class="ornament"><span>✦</span></div>
  <p class="lede hk-note">⚠ <strong>התרת הקללות אינה כלולה במעקב החי מהכותל</strong> — קוראים אותה בקצב שלכם.</p>
</header>
<main>
<section class="sec">
<div class="prose">
${hkBody}
</div>
<p style="font-size:.85rem;margin-top:2rem;color:var(--ink-soft)">מקור הטקסט: <a href="${esc(hk.sourceUrl)}" rel="noopener" target="_blank">${esc(hk.source)}</a>. ייתכנו הבדלי נוסח בין קהילות; יש לנהוג כמנהג המקום.</p>
</section>
</main>
<footer>
  <p><a href="/"><strong>סליחות עדות המזרח</strong></a> — הסדר המלא, מנוקד, עם מעקב חי מהכותל.</p>
  <p>גמר חתימה טובה</p>
</footer>
${adBlock('bottom', ADSENSE_SLOT_BOTTOM)}
<script src="/app.js?v=${ver('app.js')}" defer></script>
</body>
</html>`;
fs.writeFileSync(path.join(root, 'public/hatarat-kelalot.html'), hkHtml);

// robots + sitemap
fs.writeFileSync(path.join(root, 'public/robots.txt'),
`User-agent: *
Allow: /
Disallow: /admin\nDisallow: /sync
Disallow: /api/
Disallow: /go/
Sitemap: ${SITE}/sitemap.xml
`);

// מפת האתר מכילה רק כתובות אמיתיות. עוגנים (#) אינם דפים נפרדים וגוגל
// מתעלמת מהם — הוספתם רק מייצרת אזהרות.
const today = CONTENT_UPDATED;
fs.writeFileSync(path.join(root, 'public/sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
<url><loc>${SITE}/hatarat-kelalot</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.7</priority></url>
</urlset>`);

/* ---------- GEO: llms.txt (תקציר ומפה) ו-llms-full.txt (כל הנוסח כטקסט רגיל) ---------- */
fs.writeFileSync(path.join(root, 'public/llms.txt'),
`# סליחות עדות המזרח

> ${DESC}

האתר מביא את סדר הסליחות המלא בנוסח עדות המזרח (ספרדי), מנוקד, בחינם, עם מעקב חי שמסנכרן את הטקסט לשידור הסליחות מהכותל המערבי. מקור הטקסט: ${doc.source} (${doc.sourceUrl}).

## עובדות עיקריות
- עונת ${SEASON.year}: מתחילים בא׳ באלול — ${SEASON.elul}; אומרים עד ערב יום הכיפורים, ${SEASON.erevYk}. ראש השנה: ${SEASON.rh}. יום הכיפורים: ${SEASON.yk}.
- בני עדות המזרח אומרים סליחות מא׳ באלול, ארבעים יום; במנהג אשכנז מתחילים במוצאי השבת שלפני ראש השנה.
- הזמן המובחר: אשמורת הבוקר, השליש האחרון של הלילה לפני עלות השחר.
- הסדר כולל ${doc.sections.length} פרקים ו-${doc.wordCount} מילים, מנוקדים.

## פרקי הסדר
${doc.sections.map(s => `- [${s.title}](${SITE}/#${s.slug}): ${s.desc}`).join('\n')}

## דפים
- [סדר הסליחות המלא](${SITE}/): הטקסט המנוקד עם מעקב חי מהכותל
- [התרת קללות ונדרים](${SITE}/hatarat-kelalot): נוסח עדות המזרח, לערב ראש השנה ולערב יום כיפור
- [הנוסח המלא כטקסט רגיל](${SITE}/llms-full.txt)

## שאלות ותשובות
${FAQ.map(([q, a]) => `### ${q}\n${a}`).join('\n\n')}
`);
fs.writeFileSync(path.join(root, 'public/llms-full.txt'),
`# סליחות נוסח עדות המזרח — הנוסח המלא
מקור: ${doc.source} (${doc.sourceUrl}). ייתכנו הבדלי נוסח בין קהילות.
אתר: ${SITE}/

` + doc.sections.map(sec => `## ${sec.title}\n${sec.desc}\n\n` + sec.paragraphs.map(p =>
  (p.dir ? `(${p.dir})\n` : '') + p.w.map(w => w.t).join(' ')).join('\n\n')).join('\n\n'));

console.log('built public/index.html (%d KB), robots.txt, sitemap.xml', Math.round(html.length / 1024));
