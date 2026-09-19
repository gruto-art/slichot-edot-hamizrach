// פרסומות האתר: הגדרה אחת לבנייה (build_site) ולשרת (/go/:id).
// הקישור היוצא נקבע כאן בלבד — /go/:id מפנה רק לכתובות שברשימה (ללא הפניה פתוחה).
const OWNER_WA = '972527182810';
// מספר הוואטסאפ של דניאל (הצעות נישואין); DANEL_WHATSAPP גובר
const DANEL_WA = (process.env.DANEL_WHATSAPP || '').replace(/\D/g, '') || '972533104418';

const wa = (phone, text) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

export const ADS = {
  tech: {
    pos: 'top',
    frameSec: 3, // שניות לכל מסך — קצב שונה לכל באנר
    name: 'כלים טכנולוגיים לעסקים',
    url: wa(OWNER_WA, 'היי, ראיתי את הפרסומת באתר הסליחות ואשמח לשמוע על כלים טכנולוגיים לעסק שלי'),
    frames: [
      '<b>העסק שלך עדיין עובד ידנית?</b>',
      '<span class="ic">🤖</span> בוטים לוואטסאפ · אוטומציות · בינה מלאכותית',
      '<span class="ic">☎️</span> מערכות טלפוניות חכמות · אתרים שמביאים לקוחות',
      '<b>כלים טכנולוגיים מתקדמים לעסק שלך</b>',
      '<span class="cta">דברו איתי בוואטסאפ ←</span> 052-718-2810'
    ]
  },
  danel: {
    pos: 'bottom',
    frameSec: 4.5,
    name: 'דניאל — הצעות נישואין',
    url: wa(DANEL_WA, 'היי, ראיתי את הפרסומת באתר הסליחות ואשמח לשמוע על עיצוב הצעת נישואין'),
    logo: '/ads/danel-logo.webp',
    logoAlt: 'Daniel — עיצוב הצעות נישואין, Magic In Every Moment',
    logoW: 101, logoH: 48,
    frames: [
      '<b>דניאל</b> · עיצוב הצעות נישואין',
      'הרגע שהיא תזכור לכל החיים <span class="ic">💍</span>',
      'לוקיישנים עוצרי נשימה · פרחים · תאורה',
      '<b>תכנון וביצוע הצעות נישואין יוקרתיות</b>',
      '<span class="cta">לפרטים בוואטסאפ ←</span>'
    ]
  }
};

export const adById = id => (Object.hasOwn(ADS, id) ? ADS[id] : null);
