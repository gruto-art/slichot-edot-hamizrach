/* היגיון התקדמות: החזן מתקדם קדימה, בקצב אנושי.

   מנוע ההתאמה (matcher.js) מחפש כל אמירה בכל הסדר, והנוסחאות חוזרות — י״ג מידות,
   הפזמונים, "רחמנא". בלי היגיון התקדמות, קטע של 12 שניות שנשמע כמו פזמון שמופיע
   3,000 מילים קדימה מקפיץ לשם את הדף, ובקטע הבא הוא קופץ חזרה.

   הכללים:
   1. תנועה רגילה: מהמיקום הנוכחי קדימה, עד קצב אמירה מהיר מאוד לפי הזמן שחלף.
      מועמד בתוך החלון הזה מתקבל גם אם מועמד רחוק קיבל ניקוד גבוה יותר.
   2. קפיצה (חזן שדילג על פרק, או זיהוי ראשון): נרשמת כ"מועמדת", ומתקבלת רק אם
      הקטע הבא מאשר אותה — כלומר ממשיך ממנה בהתקדמות רגילה.
   3. קפיצה אחורה דורשת ודאות גבוהה בשני הקטעים; בפועל היא כמעט תמיד פזמון חוזר. */

const DEFAULTS = {
  maxRate: 3.5,        // מילים בשנייה — מעל קצב האמירה המהיר ביותר שנמדד
  slack: 25,           // מרווח קבוע לחלון, בגלל אורך הקטע ורעש בתמלול
  back: 6,             // נסיגה קטנה מותרת (אי-דיוק בסוף האמירה)
  minShare: 0.05,      // ודאות מינימלית למועמד שבתוך החלון
  jumpConf: 0.35,      // ודאות מינימלית לקפיצה קדימה
  backConf: 0.6,       // ודאות מינימלית לקפיצה אחורה
  pendingTtlMs: 40000  // מועמדת לקפיצה שלא אושרה — נשכחת
};

export class Tracker {
  constructor(aligner, opts = {}) {
    this.aligner = aligner;
    this.o = { ...DEFAULTS, ...opts };
    this.reset();
  }

  /** @param {number} word אינדקס גלובלי ידוע (סנכרון ידני), או -1 */
  reset(word = -1, at = 0) {
    this.pos = word >= 0 ? this.aligner.toDense(word) : -1;
    this.posAt = at;
    this.tail = [];
    this.pending = null;
  }

  /**
   * @param {string[]} tokens מילות הקטע החדש (מנורמלות)
   * @param {number} at זמן הקטע, במילישניות
   * @returns {{word:number, confidence:number, kind:'step'|'jump'|'local'} | null}
   */
  update(tokens, at) {
    if (!tokens.length) return null;
    this.tail = this.tail.concat(tokens).slice(-40);
    const hint = this.pos >= 0 ? this.aligner.toGlobal(this.pos) : -1;
    const c = this.aligner.candidates(this.tail, hint);
    if (!c) return null;
    if (this.pending && at - this.pending.at > this.o.pendingTtlMs) this.pending = null;

    const { lo, hi } = this._window(at);

    // אין צירוף רצוף — רק סריקה מקומית, שממילא מוגבלת לסביבת המיקום
    if (c.local) {
      if (this.pos < 0 || c.local.dense < lo || c.local.dense > hi) return null;
      return this._accept(c.local, at, 'local');
    }

    // 1. תנועה רגילה: המועמד החזק ביותר בתוך החלון
    if (this.pos >= 0) {
      const inWin = c.list.find(x => x.dense >= lo && x.dense <= hi);
      if (inWin && inWin.score / c.total >= this.o.minShare) {
        this.pending = null;
        return this._accept(inWin, at, 'step');
      }
    }

    // 2. קפיצה: רק בהסכמה של שני קטעים רצופים
    const top = c.list[0];
    if (!top) return null;
    const backward = this.pos >= 0 && top.dense < lo;
    const need = backward ? this.o.backConf : this.o.jumpConf;
    if (this.pending) {
      const p = this.pending;
      const dt = (at - p.at) / 1000;
      // האישור חייב לבוא ממילים חדשות בלבד: חלון התמלול עדיין מכיל את מילות הקטע
      // הקודם, והן לבדן "יאשרו" את אותה קפיצה בדיוק
      const fresh = this.aligner.candidates(tokens, this.aligner.toGlobal(p.dense));
      const confirms = fresh?.list.find(x =>
        x.dense >= p.dense - this.o.back &&
        x.dense <= p.dense + this.o.maxRate * dt + this.o.slack &&
        x.confidence >= need);
      if (confirms && p.confidence >= need) {
        this.pending = null;
        // התמלול שלפני הקפיצה שייך למקום אחר — לא לגרור אותו הלאה
        this.tail = tokens.slice();
        return this._accept(confirms, at, 'jump');
      }
    }
    if (top.confidence >= need) this.pending = { dense: top.dense, at, confidence: top.confidence };
    return null;
  }

  _window(at) {
    if (this.pos < 0) return { lo: -1, hi: -1 };
    const dt = Math.max(0, (at - this.posAt) / 1000);
    return { lo: this.pos - this.o.back, hi: this.pos + this.o.maxRate * dt + this.o.slack };
  }

  _accept(c, at, kind) {
    this.pos = c.dense;
    this.posAt = at;
    return { word: this.aligner.toGlobal(c.dense), confidence: c.confidence, kind };
  }
}
