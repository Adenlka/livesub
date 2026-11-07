// Transfer model A's punctuation and number style (SenseVoice: punctuated, Arabic digits) onto model B's output (Chinese Zipformer: more accurate characters, no punctuation, numbers in Han characters)
// Method: character-level edit-distance alignment; SenseVoice numbers are expanded to their Han readings first, and aligned Han number runs are swapped back to digits
const PUNCT = /[，。！？、；：,.!?;:…—「」『』“”"'（）()《》]/;
const DIG = '零一二三四五六七八九';

/** Arabic number string -> possible Han readings (digit by digit / positional), the one closest to target first */
function readings(num) {
  const s = num.replace(/[,，]/g, '');
  const per = [...s].map(c => c === '.' ? '点' : DIG[+c] ?? c).join('');
  const out = [per];
  if (/^\d{1,5}$/.test(s)) {
    const n = +s; const u = ['', '十', '百', '千', '万']; let r = '', zero = false; const str = String(n);
    for (let i = 0; i < str.length; i++) { const d = +str[i], p = str.length - 1 - i; if (d === 0) { zero = true; continue; } if (zero && r) r += '零'; zero = false; r += DIG[d] + u[p]; }
    if (n === 0) r = '零';
    out.push(r, r.replace(/^一十/, '十'), r.replace(/^二(?=[百千万])/, '两'));
  }
  return [...new Set(out)];
}

/** SenseVoice text -> unit sequence {ch, punct?, num?} (numbers expand to several characters, num stored on the first) */
function units(sv, guess) {
  const u = [];
  const re = /\d+(?:[.,]\d+)*%?|./gsu;
  let m;
  while ((m = re.exec(sv))) {
    const t = m[0];
    if (/^\d/.test(t)) {
      const pct = t.endsWith('%'); const core = pct ? t.slice(0, -1) : t;
      // pick a reading, preferring one that appears in text B
      const rs = readings(core).map(r => pct ? '百分之' + r : r);
      const r = rs.find(x => guess.includes(x)) ?? rs[rs.length > 1 ? 1 : 0];
      [...r].forEach((c, i) => u.push({ ch: c, num: i === 0 ? t : null, numLen: i === 0 ? r.length : 0 }));
    } else if (PUNCT.test(t)) {
      if (u.length) u[u.length - 1].after = (u[u.length - 1].after ?? '') + t;
    } else if (!/\s/.test(t)) u.push({ ch: t });
  }
  return u;
}

/**
 * @param {string} zf  Zipformer result (no punctuation)
 * @param {string} sv  SenseVoice result (punctuated)
 * @returns {string}
 */
export function transferPunct(zf, sv) {
  if (!zf || !sv) return zf || '';
  const b = [...zf.replace(/\s+/g, '')];
  const a = units(sv, zf);
  if (!a.length || !b.length) return zf;
  // edit-distance alignment (O(n·m); a subtitle is a few dozen characters, so the cost is negligible)
  const n = a.length, m = b.length;
  const D = Array.from({ length: n + 1 }, (_, i) => { const r = new Uint16Array(m + 1); r[0] = i; return r; });
  for (let j = 1; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1].ch === b[j - 1] ? 0 : 1));
  // backtrack: after[j] = punctuation to add after b's j-th character; map[i] = which character of b unit i of a aligns to (-1 = deleted)
  const map = new Int32Array(n).fill(-1);
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (a[i - 1].ch === b[j - 1] ? 0 : 1)) { map[i - 1] = j - 1; i--; j--; }
    else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { map[i - 1] = -1; i--; }
    else j--;
  }
  const after = new Array(m).fill('');
  const numAt = new Map(); // index into b -> {text, len}
  let lastJ = -1;
  for (let i = 0; i < n; i++) {
    if (map[i] >= 0) lastJ = map[i];
    if (a[i].num) {
      // swap in Arabic digits only if the whole number run aligns exactly
      let ok = true; const j0 = map[i];
      for (let k = 0; k < a[i].numLen; k++) { const jj = map[i + k]; if (jj !== j0 + k || a[i + k].ch !== b[jj]) { ok = false; break; } }
      if (ok && j0 >= 0) numAt.set(j0, { text: a[i].num, len: a[i].numLen });
    }
    if (a[i].after) { const j = map[i] >= 0 ? map[i] : lastJ; if (j >= 0 && !after[j].includes(a[i].after)) after[j] += a[i].after; }
  }
  // sentence end: if SV has final punctuation but the alignment lands mid-b, move it to the end of b
  const tail = a[n - 1].after;
  if (tail && !after[m - 1]) { for (let j = 0; j < m - 1; j++) if (after[j] === tail && j >= m - 3) after[j] = ''; after[m - 1] = tail; }
  let out = '';
  for (let j = 0; j < m; j++) {
    const nu = numAt.get(j);
    if (nu) { out += nu.text; j += nu.len - 1; out += after[j]; continue; }
    out += b[j] + after[j];
  }
  return out;
}
