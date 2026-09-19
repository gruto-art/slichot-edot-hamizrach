// פרסומות האתר: הגדרה אחת לבנייה (build_site) ולשרת (/go/:id).
// הקישור היוצא נקבע כאן בלבד — /go/:id מפנה רק לכתובות שברשימה (ללא הפניה פתוחה).
// כל מסך (frame) מקבל סוג הנפשה משלו — המחלקות fx-* מוגדרות ב-public/style.css.
const OWNER_WA = '972527182810';
// מספר הוואטסאפ של דניאל (הצעות נישואין); DANEL_WHATSAPP גובר
const DANEL_WA = (process.env.DANEL_WHATSAPP || '').replace(/\D/g, '') || '972533104418';

const wa = (phone, text) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
// עוטף כל מילה כדי שתיכנס בתורה (--k = מקום המילה)
const words = t => t.split(' ').map((w, k) => `<i style="--k:${k}">${w}</i>`).join(' ');

export const ADS = {
  tech: {
    pos: 'top',
    frameSec: 3, // שניות לכל מסך — קצב שונה לכל באנר
    theme: 'tech',
    name: 'כלים טכנולוגיים לעסקים',
    url: wa(OWNER_WA, 'היי, ראיתי את הפרסומת באתר הסליחות ואשמח לשמוע על כלים טכנולוגיים לעסק שלי'),
    deco: '<span class="grid"></span><span class="orb"></span><span class="scan"></span>',
    frames: [
      '<span class="fx-type">העסק שלך עדיין עובד ידנית?</span>',
      '<span class="fx-chips"><i style="--k:0">🤖 בוטים לוואטסאפ</i><i style="--k:1">⚡ אוטומציות</i><i style="--k:2">🧠 בינה מלאכותית</i></span>',
      '<span class="fx-split"><b>מערכות טלפוניות חכמות</b><em>אתרים שמביאים לקוחות</em></span>',
      `<span class="fx-glow">${words('כלים טכנולוגיים מתקדמים לעסק שלך')}</span>`,
      '<span class="fx-cta"><span class="pill"><span class="ring"></span>דברו איתי בוואטסאפ</span><span class="num">052-718-2810</span></span>'
    ]
  },
  danel: {
    pos: 'bottom',
    frameSec: 4.5,
    theme: 'lux',
    name: 'דניאל — הצעות נישואין',
    url: wa(DANEL_WA, 'היי, ראיתי את הפרסומת באתר הסליחות ואשמח לשמוע על עיצוב הצעת נישואין'),
    logo: '/ads/danel-logo.webp',
    logoAlt: 'Daniel — עיצוב הצעות נישואין, Magic In Every Moment',
    logoW: 101, logoH: 48,
    deco: [0, 1, 2, 3].map(p => `<span class="petal" style="--p:${p}"></span>`).join('')
      + [0, 1, 2].map(p => `<span class="spark" style="--p:${p}"></span>`).join(''),
    frames: [
      `<span class="fx-rise">${words('עיצוב הצעות נישואין')}</span>`,
      '<span class="fx-blur">הרגע שהיא תזכור לכל החיים <span class="ring-ic">💍</span></span>',
      '<span class="fx-line"><i style="--k:0">לוקיישנים עוצרי נשימה</i><i style="--k:1">פרחים</i><i style="--k:2">תאורה</i></span>',
      '<span class="fx-script">Magic In Every Moment</span>',
      '<span class="fx-cta"><span class="pill">לתיאום הצעה בוואטסאפ ←</span></span>'
    ]
  }
};

export const adById = id => (Object.hasOwn(ADS, id) ? ADS[id] : null);
