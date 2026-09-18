/* מריץ את המנגנון הקיים (Aligner + Tracker) על התמלולים השמורים ומדפיס זיהוי וקפיצות.
   להשוואת שינויים בהתאמה בלי לתמלל שוב. שימוש: node research/eval_tracker.mjs [סיומת-מטמון] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Aligner, tokenize } from '../server/matcher.js';
import { Tracker } from '../server/tracker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'research/kotel-transcripts');
const suffix = process.argv[2] || '';
const words = JSON.parse(fs.readFileSync(path.join(root, 'data/index_words.json'), 'utf8'));
let T = { segs: 0, hits: 0, flips: 0 };
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(`.stt-12s${suffix}.json`)).sort()) {
  const tr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const times = Object.keys(tr).map(Number).sort((a, b) => a - b);
  const tracker = new Tracker(new Aligner(words));
  const hits = [];
  for (const at of times) {
    const r = tracker.update(tokenize(tr[at]), at * 1000);
    if (r) hits.push(r.word);
  }
  let flips = 0;
  for (let i = 1; i < hits.length; i++)
    if (Math.abs(hits[i] - hits[i - 1]) > 100 && hits.slice(i + 1, i + 4).some(h => Math.abs(h - hits[i - 1]) < 60)) flips++;
  console.log(`${f.split('.')[0].padEnd(8)} זוהו ${hits.length}/${times.length} (${Math.round(hits.length / times.length * 100)}%) · קפיצות הלוך-חזור ${flips}`);
  T.segs += times.length; T.hits += hits.length; T.flips += flips;
}
console.log(`סה״כ ${T.hits}/${T.segs} (${Math.round(T.hits / T.segs * 100)}%) · קפיצות ${T.flips}`);
