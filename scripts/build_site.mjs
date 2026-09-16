// בונה את public/index.html — כל הטקסט מוטמע ב-HTML לצורכי SEO (ללא תלות ב-JS)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doc = JSON.parse(fs.readFileSync(path.join(root, 'data/slichot.json'), 'utf8'));
const SITE = process.env.SITE_URL || 'https://slichot.onrender.com';
const ADSENSE_CLIENT = process.env.ADSENSE_CLIENT || '';
const ADSENSE_SLOT_TOP = process.env.ADSENSE_SLOT_TOP || '';
const ADSENSE_SLOT_BOTTOM = process.env.ADSENSE_SLOT_BOTTOM || '';
const GA_ID = process.env.GA_MEASUREMENT_ID || '';

const ver = f => {
  try { return String(fs.statSync(path.join(root, 'public', f)).mtimeMs & 0x7fffffff); } catch { return '1'; }
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TITLE = 'סליחות עדות המזרח — נוסח ספרדי מלא ומנוקד | מעקב חי מהכותל';
const DESC = 'סליחות עדות המזרח בנוסח הספרדי המלא, מנוקד ומעומד לקריאה נוחה: לך ה׳ הצדקה, בן אדם מה לך נרדם, י״ג מידות, אשמנו, אדון הסליחות, אבינו מלכנו ושומר ישראל. כולל מעקב חי אחרי הסליחות בכותל המערבי שגולל את המילים בזמן אמת.';
const KEYWORDS = 'סליחות עדות המזרח, סליחות ספרדים, סליחות נוסח ספרדי, סליחות מנוקד, סדר סליחות עדות המזרח, סליחות לאשמורת הבוקר, לך ה׳ הצדקה, בן אדם מה לך נרדם, י״ג מידות, אדון הסליחות, אשמנו, אבינו מלכנו, סליחות אלול, סליחות עשרת ימי תשובה, סליחות בכותל, סליחות חי מהכותל, טקסט סליחות מלא';

function adBlock(pos, slot) {
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

const jsonld = [
  {
    '@context': 'https://schema.org', '@type': 'WebSite',
    name: 'סליחות עדות המזרח', url: SITE, inLanguage: 'he',
    description: DESC,
    potentialAction: { '@type': 'ReadAction', target: SITE }
  },
  {
    '@context': 'https://schema.org', '@type': 'Book',
    name: 'סליחות נוסח עדות המזרח', alternateName: ['סליחות ספרדים', 'סדר סליחות עדות המזרח'],
    inLanguage: 'he', bookFormat: 'https://schema.org/EBook', isAccessibleForFree: true,
    url: SITE, about: 'סדר הסליחות לחודש אלול ולעשרת ימי תשובה במנהג עדות המזרח',
    genre: 'ליטורגיה יהודית', numberOfPages: 1, abstract: plain.slice(0, 500),
    publisher: { '@type': 'Organization', name: 'סליחות עדות המזרח', url: SITE }
  },
  {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [
      ['מהן סליחות עדות המזרח?', 'סליחות עדות המזרח הן סדר תפילות הבקשה והרחמים שנוהגים בני עדות המזרח והספרדים לומר מראש חודש אלול ועד יום הכיפורים, באשמורת הבוקר. הסדר כולל את "לך ה׳ הצדקה", "בן אדם מה לך נרדם", י״ג מידות של רחמים, וידוי, "אדון הסליחות", "אבינו מלכנו" ו"שומר ישראל".'],
      ['מתי מתחילים לומר סליחות בנוסח ספרדי?', 'בני עדות המזרח מתחילים לומר סליחות מראש חודש אלול (א׳ באלול) וממשיכים בכל יום עד יום הכיפורים, בשונה ממנהג אשכנז שמתחיל במוצאי השבת שלפני ראש השנה.'],
      ['באיזו שעה אומרים סליחות?', 'המנהג המקורי הוא לומר סליחות באשמורת הבוקר, בשליש האחרון של הלילה לפני עלות השחר — שעת רצון מיוחדת, כמו שנאמר "קמתי באשמורת לבקש על עווני".'],
      ['מה זה מעקב חי אחרי הסליחות בכותל?', 'תכונה באתר שמסנכרנת את הטקסט עם השידור החי של הסליחות מהכותל המערבי: מערכת תמלול בזמן אמת מזהה היכן אוחז החזן, והאתר גולל ומדגיש את המילים המדויקות שנאמרות באותו רגע.'],
      ['האם הטקסט מנוקד?', 'כן. כל סדר הסליחות באתר מנוקד ניקוד מלא ומעומד בפריסה נוחה לקריאה, גם במסך הטלפון וגם במחשב, עם אפשרות להגדלת הגופן ומצב לילה.']
    ].map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700;900&family=Noto+Serif+Hebrew:wght@400;500;600&display=swap">
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
    <button class="btn" id="themeBtn" title="מצב יום / לילה" aria-label="החלפת ערכת צבעים">מצב לילה</button>
  </div>
</nav>

<header class="masthead">
  <p class="kicker">אַשְׁמוֹרֶת הַבֹּקֶר</p>
  <h1>סְלִיחוֹת עֲדוֹת הַמִּזְרָח<span class="sub">נוסח ספרדי — סדר מלא ומנוקד</span></h1>
  <div class="ornament"><span>✦</span></div>
  <p class="lede">כל סדר <strong>סליחות עדות המזרח</strong> — מנוקד ניקוד מלא ומעומד לקריאה, מ״קמתי באשמורת״ ועד ״שומר ישראל״. ובנוסף: מעקב חי שגולל את המילים לפי מה שאומרים ברגע זה בכותל המערבי.</p>
</header>

<main>
  <details class="toc">
    <summary>סדר הסליחות — תוכן העניינים (${doc.sections.length} פרקים)</summary>
    <ol>${toc}</ol>
  </details>

  <article id="slichot" class="tracking">
${body}
  </article>

  <section class="seo-block">
    <h2>על סדר סליחות עדות המזרח</h2>
    <p><strong>סליחות עדות המזרח</strong> הן סדר תפילות הרחמים והבקשה שנוהגים בני עדות המזרח והספרדים לומר באשמורת הבוקר, מראש חודש אלול ועד יום הכיפורים. בשונה ממנהג אשכנז, שבו מתחילים לומר סליחות במוצאי השבת שלפני ראש השנה, בנוסח הספרדי אומרים סליחות ארבעים יום רצופים — כנגד ארבעים הימים ששהה משה רבנו בהר סיני עד שנתרצה הקדוש ברוך הוא לישראל ביום הכיפורים.</p>
    <h3>מהו הזמן הראוי לאמירת סליחות?</h3>
    <p>הזמן המובחר לאמירת הסליחות בנוסח עדות המזרח הוא באשמורת הבוקר — השליש האחרון של הלילה, לפני עלות השחר, שעה שהיא עת רצון. על כך נפתח סדר הסליחות במילים ״קַמְתִּי בְּאַשְׁמוֹרֶת, לְבַקֵּשׁ עַל עֲוֹנִי״.</p>
    <h3>מה כולל הסדר שבאתר זה?</h3>
    <p>הסדר המלא שלפניכם כולל: אשרי וחצי קדיש, ״בן אדם מה לך נרדם״, ״לך ה׳ הצדקה״, ״למענך אלהי״, הפיוטים ״שבט יהודה״ ו״אנשי אמונה אבדו״, ״אל מלך יושב על כסא רחמים״ עם שלוש עשרה מידות של רחמים (״ויעבור״), בקשות ה״רחמנא״, סדר הווידוי ו״אשמנו״, ״שמע ישראל״, ״ה׳ מלך״, ״אלהינו שבשמים״, ״עננו״, ״אדון הסליחות״, ״אל אדיר שמך״, ״ה׳ עשה למען שמך״, ״חמול על עמך״, ״אבינו מלכנו״, ״שומר ישראל״, ״שיר המעלות ממעמקים״ וקדיש.</p>
    <h3>מעקב חי אחרי הסליחות בכותל המערבי</h3>
    <p>לחיצה על ״מעקב אחרי הכותל״ מפעילה סנכרון בזמן אמת: מערכת תמלול מאזינה לשידור החי של הסליחות מרחבת הכותל המערבי, מזהה את המילים הנאמרות ומצליבה אותן מול הטקסט שבאתר. התוצאה — הדף גולל אוטומטית ומדגיש בדיוק את המילה שאומר החזן ברגע זה, כך שאפשר להצטרף לסליחות מכל מקום בעולם בלי לאבד את המקום.</p>
    <h3>נגישות וקריאה</h3>
    <p>הטקסט מעומד בגופן מכובד עם ריווח שורות מוגדל, כדי שהניקוד יישאר קריא גם במסך קטן. אפשר להגדיל ולהקטין את הגופן, ולעבור למצב לילה — נוח במיוחד לאמירת סליחות בשעות הלילה והאשמורת.</p>
    <p style="font-size:.85rem;margin-top:1.6rem">מקור הטקסט: <a href="${esc(doc.sourceUrl)}" rel="noopener" target="_blank">${esc(doc.source)}</a>. ייתכנו הבדלי נוסח בין קהילות; יש לנהוג כמנהג המקום.</p>
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

// robots + sitemap
fs.writeFileSync(path.join(root, 'public/robots.txt'),
`User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Sitemap: ${SITE}/sitemap.xml
`);

const urls = [`<url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`]
  .concat(doc.sections.map(s => `<url><loc>${SITE}/#${s.slug}</loc><priority>0.6</priority></url>`));
fs.writeFileSync(path.join(root, 'public/sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`);

console.log('built public/index.html (%d KB), robots.txt, sitemap.xml', Math.round(html.length / 1024));
