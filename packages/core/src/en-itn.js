// English inverse text normalization: Parakeet-TDT spells numbers out ("twenty twenty one", "seven percent"); subtitles get digits
// Conservative: only numbers >= 10, decimals, percentages, years and "Q four"; a lone one/two stays a word (normal English subtitle style)
const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const isNum = (w) => w in UNITS || w in TENS || w in SCALES;

/** Parse a run of number words into groups; each group is one number read in the usual way */
function parseGroups(words) {
  const groups = []; let cur = null;
  const flush = () => { if (cur) groups.push(cur); cur = null; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'and') { if (!cur || cur.last !== 'scale') return null; continue; }
    if (w in SCALES) {
      if (!cur) return null;
      const s = SCALES[w];
      if (s === 100) { cur.small = (cur.small || 1) * 100; cur.hasHundred = true; }
      else { cur.total += (cur.small || 1) * s; cur.small = 0; cur.lastScale = w; }
      cur.scale = true; cur.last = 'scale'; continue;
    }
    const v = UNITS[w] ?? TENS[w];
    if (cur) {
      // start a new group: previous was a unit/teen, or tens followed by tens, with no scale word in between
      const lastKind = cur.last;
      const continues = (lastKind === 'tens' && w in UNITS && v < 10) || lastKind === 'scale' || (lastKind === 'hundred');
      if (!continues) flush();
    }
    if (!cur) cur = { total: 0, small: 0, scale: false, words: 0 };
    cur.small += v; cur.words++;
    cur.last = w in TENS ? 'tens' : 'unit';
  }
  flush();
  return groups.map(g => ({ value: g.total + g.small, scale: g.scale, lastScale: g.lastScale, small: g.small, total: g.total }));
}

function render(words) {
  // years: two two-digit groups (twenty twenty one -> 2021, nineteen ninety nine -> 1999)
  const gs = parseGroups(words);
  if (!gs) return null;
  if (gs.length === 2 && !gs[0].scale && !gs[1].scale && gs[0].value >= 10 && gs[0].value <= 99 && (gs[1].value >= 10 && gs[1].value <= 99 || words.at(-1) === 'hundred'))
    return String(gs[0].value) + String(gs[1].value).padStart(2, '0');
  if (gs.length === 2 && !gs[0].scale && gs[0].value >= 10 && gs[0].value <= 99 && words[words.length - 2] === 'oh' && gs[1].value < 10) // twenty oh five
    return String(gs[0].value) + '0' + gs[1].value;
  if (gs.length !== 1) return null;
  const g = gs[0];
  // "sixty million" -> 60 million (easier to read than 60000000)
  if (g.lastScale && ['million', 'billion', 'trillion'].includes(g.lastScale) && g.small === 0) {
    const pre = g.total / SCALES[g.lastScale];
    if (Number.isInteger(pre) && pre < 1000) return `${pre} ${g.lastScale}`;
  }
  return String(g.value);
}

/**
 * @param {string} text
 * @returns {string}
 */
export function enItn(text) {
  if (!text) return text;
  const toks = text.split(/(\s+)/); // keep whitespace
  const W = []; // { i: index into toks, word: lower-case letters only, pre, post }
  for (let i = 0; i < toks.length; i += 2) {
    const m = /^([^A-Za-z]*)([A-Za-z]+(?:-[A-Za-z]+)?)([^A-Za-z]*)$/.exec(toks[i]);
    W.push(m ? { i, pre: m[1], raw: m[2], word: m[2].toLowerCase(), post: m[3] } : { i, raw: toks[i], word: null, pre: '', post: '' });
  }
  const out = [];
  for (let k = 0; k < W.length;) {
    const w = W[k];
    // hyphenated: twenty-one
    const parts = w.word?.includes('-') ? w.word.split('-') : null;
    if (w.word && (isNum(w.word) || (parts && parts.every(isNum))) && !(w.word in SCALES)) {
      // collect the longest run of number words (no punctuation inside)
      const span = []; let j = k;
      while (j < W.length) {
        const x = W[j]; if (!x.word) break;
        if (j > k && x.pre) break;
        const ps = x.word.split('-');
        const ok = ps.every(isNum) || (x.word === 'and' && span.length && W[j + 1]?.word && isNum(W[j + 1].word)) || (x.word === 'point' && span.length && W[j + 1]?.word in UNITS);
        if (!ok) break;
        span.push(...ps);
        j++;
        if (x.post) break; // a comma/period ends the run
      }
      // drop a trailing 'and'
      while (span.at(-1) === 'and') { span.pop(); j--; }
      // decimals: X point Y Z
      let str = null; const pi = span.indexOf('point');
      if (pi > 0) {
        const left = span.slice(0, pi); const a = left.some(x => x in SCALES) ? null : render(left); const frac = span.slice(pi + 1).map(x => UNITS[x]);
        if (a != null && frac.every(d => d != null && d < 10)) str = `${a}.${frac.join('')}`;
      } else str = render(span);
      const next = W[j];
      const pct = next?.word === 'percent';
      const prevQ = out.length && /^Q$/i.test(W[k - 1]?.raw) ;
      const val = str != null ? parseFloat(str) : NaN;
      if (str != null && (pct || prevQ || val >= 10 || str.includes('.') || /\d \w/.test(str))) {
        let s = w.pre + str;
        let last = W[j - 1];
        if (pct) { s += '%'; last = next; j++; }
        s += last.post;
        if (prevQ) { const q = out.pop(); s = q.replace(/\s+$/, '') + s.replace(/^\s+/, ''); }
        out.push(s); k = j; continue;
      }
    }
    out.push(toks[w.i]);
    k++;
  }
  // re-join with the original spacing
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
