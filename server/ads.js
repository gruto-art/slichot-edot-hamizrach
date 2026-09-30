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
    frameSec: 12, // מסך אחד עם ציר זמן פנימי של 12 שנ׳ (ב-CSS) — אין החלפת מסכים
    theme: 'wa',
    name: 'בוט וואטסאפ לעסקים',
    url: wa(OWNER_WA, 'היי, ראיתי באתר הסליחות את הבוט שעונה ללקוחות באמצע הלילה — אני רוצה כזה לעסק שלי'),
    deco: '',
    // הדגמה במקום הבטחה: לקוח כותב ב-04:52, הבוט עונה לבד, ואז המשפט שמחבר לרגע של הקורא (הוא בסליחות).
    // קריאה לפעולה קבועה בצד — לא מחכה לתורה בסבב.
    frames: [
      '<span class="bz"><span class="bz-stage">'
        + '<span class="bz-in"><b><s>לקוח חדש · </s>04:52</b>היי, יש תור פנוי מחר?</span>'
        + '<span class="bz-dots"><i></i><i></i><i></i></span>'
        + '<span class="bz-out">בטח! 10:00 או 12:30? <u>✓✓</u></span>'
        + '<span class="bz-punch">הבוט סגר תור — <em>בזמן שאתה בסליחות</em></span>'
        + '</span><span class="bz-cta"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z"/></svg>אני רוצה כזה</span></span>'
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
