/* Jev (TypeSafe) במצב צל: לכל קטע מתומלל שואלים באיזה פרק החזן נמצא, ורושמים לקובץ
   לצד מה שהמנגנון הקיים החליט. אינו משפיע על הדף — רק אוסף נתונים להשוואה.
   נבחן על שלושה ערבי כותל (research/jev_experiment.mjs): 80% התאמה, 90–97% כשהוא בטוח.

   הפעלה: JEV_SHADOW=1 TYPESAFE_API_KEY=… (לוג: JEV_LOG, ברירת מחדל ~/jev-shadow.jsonl) */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY = process.env.TYPESAFE_API_KEY || '';
export const jevEnabled = process.env.JEV_SHADOW === '1' && !!KEY;
const LOG = process.env.JEV_LOG || path.join(os.homedir(), 'jev-shadow.jsonl');

const NONE_TEXT = 'לא טקסט הסליחות: דרשה, הכרזה, מי שברך, ברכות, ניגון בלי מילים, רעש או שקט';
const INSTR = 'לפניך תמלול אוטומטי (עם שגיאות) של השניות האחרונות מתוך שידור סליחות בנוסח עדות המזרח מהכותל. ' +
  'השורה האחרונה היא הרגע הנוכחי. באיזה פרק של הסליחות החזן והקהל נמצאים עכשיו? ' +
  'כל אפשרות היא פרק עם הטקסט שלו. אם ברגע הנוכחי לא נאמר טקסט מהסליחות — בחר באפשרות "none".';

const plain = t => t.replace(/[֑-ׇ]/g, '').replace(/[^א-ת ]/g, ' ').replace(/\s+/g, ' ').trim();

/** אפשרויות הבחירה: כל פרק עם הטקסט המלא שלו (כך נמדדו התוצאות הטובות) */
function buildCriteria(doc) {
  const c = { none: NONE_TEXT };
  doc.sections.forEach((s, n) => {
    const ws = [];
    for (const p of s.paragraphs) for (const w of p.w) ws.push(plain(w.t));
    c['s' + n] = `${plain(s.title)}: ${ws.filter(Boolean).join(' ')}`;
  });
  return c;
}

export class JevShadow {
  constructor(doc) {
    this.doc = doc;
    this.criteria = buildCriteria(doc);
    this.recent = [];
    this.errors = 0;
  }

  /** נקרא לכל קטע מתומלל; לא ממתינים לו ולא זורק */
  observe(text, tracked, meta = {}) {
    text = String(text || '').trim();
    if (!text) return;
    this.recent = this.recent.concat(text).slice(-3);
    const at = new Date().toISOString();
    const recent = this.recent.slice();
    const t0 = Date.now();
    this._ask(recent).then(a => {
      const choice = a.choice === 'none' ? 'none' : this.doc.sections[Number(a.choice.slice(1))]?.title;
      this._log({ at, text, tracker: tracked, jev: choice, conf: a.confidence, pNone: a.probabilities?.none ?? null, ms: Date.now() - t0, ...meta });
    }).catch(e => {
      if (this.errors++ < 5) console.warn('[jev]', e.message);
      this._log({ at, text, tracker: tracked, error: String(e.message).slice(0, 200), ...meta });
    });
  }

  async _ask(recent) {
    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: { 'תמלול (מהישן לחדש)': recent },
        questions: { where: { type: 'choice', instructions: INSTR, criteria: this.criteria } }
      }),
      signal: AbortSignal.timeout(15000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Jev ${r.status} ${JSON.stringify(j).slice(0, 150)}`);
    return j.answers.where;
  }

  _log(obj) {
    try { fs.appendFileSync(LOG, JSON.stringify(obj) + '\n'); } catch {}
  }
}
