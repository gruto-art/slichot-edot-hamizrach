/* התאמת תמלול חי אל טקסט הסליחות — מוצא היכן אוחז החזן */

const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const SEP = '|';

export function normalizeWord(w) {
  w = w.replace(/[֑-ׇ]/g, '').replace(/[^א-ת]/g, '');
  return w.split('').map(c => FINALS[c] || c).join('');
}

// שלד עיצורי: הסרת אותיות אהו"י (מקור עיקרי לשגיאות תמלול בעברית)
const skeleton = w => w.replace(/[אהוי]/g, '') || w;

export function tokenize(text) {
  return String(text || '').split(/\s+/).map(normalizeWord).filter(Boolean);
}

export class Aligner {
  /** @param {string[]} words מערך המילים המנורמלות של כל הסדר (כולל ריקות במקומן) */
  constructor(words, opts = {}) {
    this.words = words;
    this.n = opts.n || 3;
    // מיפוי אינדקס "דחוס" (רק מילים אמיתיות) -> אינדקס גלובלי
    this.real = [];
    for (let i = 0; i < words.length; i++) if (words[i]) this.real.push(i);
    this.dense = this.real.map(i => words[i]);
    this.gramIndex = this._buildIndex(this.dense, w => w);
    this.skelIndex = this._buildIndex(this.dense, skeleton);
  }

  _buildIndex(arr, fn) {
    const m = new Map();
    const n = this.n;
    for (let i = 0; i + n <= arr.length; i++) {
      let k = '';
      for (let j = 0; j < n; j++) k += (j ? SEP : '') + fn(arr[i + j]);
      let l = m.get(k);
      if (!l) m.set(k, l = []);
      l.push(i);
    }
    return m;
  }

  /**
   * @param {string[]} tokens מילות התמלול האחרונות (מנורמלות)
   * @param {number} hint אינדקס גלובלי משוער נוכחי (-1 אם אין)
   */
  locate(tokens, hint = -1) {
    const n = this.n;
    if (!tokens || tokens.length < n) return null;
    const tail = tokens.slice(-24);
    const hintDense = hint >= 0 ? this._toDense(hint) : -1;
    const votes = new Map(); // אינדקס-דחוס-של-סוף-האמירה -> ניקוד

    const cast = (index, fn, weight) => {
      for (let t = 0; t + n <= tail.length; t++) {
        let k = '';
        for (let j = 0; j < n; j++) k += (j ? SEP : '') + fn(tail[t + j]);
        const hits = index.get(k);
        if (!hits || hits.length > 60) continue;              // מדלג על צירופים נפוצים מדי
        const recency = 0.45 + 0.55 * ((t + n) / tail.length); // משקל גדל לסוף התמלול
        const rarity = 1 / Math.sqrt(hits.length);
        for (const h of hits) {
          const end = h + n - 1 + (tail.length - (t + n));     // היכן אמור להיות סוף האמירה
          let score = weight * recency * rarity;
          if (hintDense >= 0) {
            const d = end - hintDense;
            if (d >= -4 && d <= 90) score *= 1.9;              // התקדמות טבעית קדימה
            else if (Math.abs(d) < 400) score *= 1.15;
          }
          votes.set(end, (votes.get(end) || 0) + score);
        }
      }
    };

    cast(this.gramIndex, w => w, 1);
    if (votes.size === 0) cast(this.skelIndex, skeleton, 0.72);
    if (votes.size === 0) return null;

    // איחוד קולות שכנים (עד שתי מילים) כדי לייצב את התוצאה
    const merged = new Map();
    for (const [pos, sc] of votes) {
      for (let d = -2; d <= 2; d++) {
        const p = pos + d;
        merged.set(p, (merged.get(p) || 0) + sc * (d === 0 ? 1 : 0.4));
      }
    }
    let best = -1, bestScore = 0, total = 0;
    for (const [pos, sc] of merged) { total += sc; if (sc > bestScore) { bestScore = sc; best = pos; } }
    if (best < 0) return null;

    // נורמול: נתח הקולות של המועמד המוביל, מתוח לסקלה קריאה (0.38 ומעלה = ודאות מלאה)
    const share = total > 0 ? bestScore / total : 0;
    const confidence = Math.max(0, Math.min(1, Math.round(share * 2.7 * 100) / 100));
    const dense = Math.max(0, Math.min(this.dense.length - 1, best));
    return { word: this.real[dense], dense, confidence: Math.round(confidence * 100) / 100, matched: tail.length };
  }

  _toDense(globalIdx) {
    let lo = 0, hi = this.real.length - 1, res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.real[mid] <= globalIdx) { res = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return res;
  }

  /** קידום משוער לפי קצב אמירה כשאין תמלול חדש */
  drift(globalIdx, ms, wordsPerMinute = 95) {
    const d = this._toDense(globalIdx);
    if (d < 0) return globalIdx;
    const adv = Math.round((wordsPerMinute / 60000) * ms);
    return this.real[Math.min(this.dense.length - 1, d + adv)];
  }
}
