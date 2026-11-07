// CTC decoding + SentencePiece-style token joining
export function parseTokens(text) {
  const tokens = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    // 'token id'; the separator may be a space or a tab (the token itself may be a space)
    const m = /^(.*)[ \t](\d+)\s*$/.exec(line);
    if (m) tokens[Number(m[2])] = m[1];
  }
  return tokens;
}

/**
 * Greedy decoding
 * @param logprobs Float32Array [T, V] (log-softmax or logits; confidence is only meaningful for log-softmax)
 * @returns {{text:string, conf:number, ids:number[], frames:number[]}} frames = frame index of each emitted token
 */
export function ctcGreedy(logprobs, T, V, tokens, blank = V - 1) {
  let prev = -1, sumMax = 0;
  const ids = [], frames = [];
  for (let t = 0; t < T; t++) {
    let best = 0, bv = -Infinity;
    const o = t * V;
    for (let v = 0; v < V; v++) { const x = logprobs[o + v]; if (x > bv) { bv = x; best = v; } }
    if (best !== blank && best !== prev) { ids.push(best); frames.push(t); sumMax += bv; }
    prev = best;
  }
  return { text: joinTokens(ids, tokens), conf: ids.length ? Math.exp(sumMax / ids.length) : 0, ids, frames };
}

export function joinTokens(ids, tokens) {
  return ids.map(i => tokens[i] ?? '').join('').replace(/▁/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Find sounding regions (seconds) from the energy envelope. Threshold = peak energy - 35 dB, but not below -55 dBFS */
export function voicedSpans(audio, { win = 512, minDur = 0.35 } = {}) {
  const n = Math.floor(audio.length / win), db = new Float32Array(n);
  let max = -120;
  for (let i = 0; i < n; i++) {
    let s = 0; for (let j = i * win; j < (i + 1) * win; j++) s += audio[j] * audio[j];
    db[i] = 10 * Math.log10(s / win + 1e-12); if (db[i] > max) max = db[i];
  }
  const th = Math.max(max - 35, -55), spans = [];
  for (let i = 0; i < n;) {
    if (db[i] > th) { let j = i; let gap = 0; while (j < n && (db[j] > th || ++gap < 6)) { if (db[j] > th) gap = 0; j++; } const a = i * win / 16000, b = (j - gap) * win / 16000; if (b - a >= minDur) spans.push([a, b]); i = j; }
    else i++;
  }
  return spans;
}

// --- hotwords (contextual biasing) ---
/** Split a hotword into tokens with the vocabulary (longest match; tries both forms of SentencePiece's word-initial ▁) */
export function tokenizeHotword(word, vocab) {
  if (!vocab._index) { vocab._index = new Map(); vocab.forEach((t, i) => { if (t != null && !vocab._index.has(t)) vocab._index.set(t, i); }); vocab._maxLen = Math.max(...vocab.filter(Boolean).map(t => t.length)); }
  const idx = vocab._index;
  const variants = [];
  for (const lead of ['▁', '']) {
    const s = word.replace(/\s+/g, '▁');
    const ids = []; let i = 0, ok = true, first = true;
    while (i < s.length) {
      let found = -1, len = 0;
      for (let l = Math.min(vocab._maxLen, s.length - i); l > 0; l--) {
        const piece = (first ? lead : '') + s.slice(i, i + l);
        if (idx.has(piece)) { found = idx.get(piece); len = l; break; }
      }
      if (found < 0) { ok = false; break; }
      ids.push(found); i += len; first = false;
    }
    if (ok && ids.length) variants.push(ids);
  }
  return variants;
}

export function buildHotwordTrie(words, vocab) {
  const root = { next: new Map(), end: false, depth: 0 };
  for (const w of words) for (const ids of tokenizeHotword(w, vocab)) {
    let n = root;
    for (const id of ids) { if (!n.next.has(id)) n.next.set(id, { next: new Map(), end: false, depth: n.depth + 1 }); n = n.next.get(id); }
    n.end = true;
  }
  return root;
}

const LOGZERO = -1e30;
const lse = (a, b) => a === LOGZERO ? b : b === LOGZERO ? a : (a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b)));

/**
 * CTC prefix beam search + hotword bonus (same idea as sherpa-onnx's ContextGraph: add a bonus per matched token, refund it when the match fails)
 * @param logprobs [T, V] after log-softmax
 */
export function ctcBeamHotwords(logprobs, T, V, tokens, { blank = V - 1, beam = 6, topk = 8, trie, bonus = 2.0 } = {}) {
  // prefix key -> {ids, pb, pnb, node, ctx}
  let beams = new Map([['', { ids: [], pb: 0, pnb: LOGZERO, node: trie, ctx: 0, frames: [] }]]);
  const advance = (node, ctx, c) => {
    if (!trie) return { node, ctx, add: 0 };
    let n = node.next.get(c);
    if (n) { const nc = ctx + bonus; return n.end && !n.next.size ? { node: trie, ctx: 0, add: bonus } : { node: n, ctx: nc, add: bonus }; }
    // match failed: refund the bonus and try matching from the start
    const back = node.end ? 0 : -ctx;
    n = trie.next.get(c);
    if (n) return { node: n, ctx: bonus, add: back + bonus };
    return { node: trie, ctx: 0, add: back };
  };
  for (let t = 0; t < T; t++) {
    const o = t * V;
    // candidates for this frame: top-k + blank
    const cand = [];
    for (let v = 0; v < V; v++) {
      const x = logprobs[o + v];
      if (cand.length < topk) { cand.push([v, x]); if (cand.length === topk) cand.sort((a, b) => b[1] - a[1]); }
      else if (x > cand[topk - 1][1]) { cand[topk - 1] = [v, x]; cand.sort((a, b) => b[1] - a[1]); }
    }
    const pBlank = logprobs[o + blank];
    const next = new Map();
    const get = (key, src, ids, node, ctx, frames) => {
      let e = next.get(key);
      if (!e) { e = { ids, pb: LOGZERO, pnb: LOGZERO, node, ctx, frames }; next.set(key, e); }
      return e;
    };
    for (const [key, b] of beams) {
      const tot = lse(b.pb, b.pnb);
      // 1) emit blank: prefix unchanged
      const eb = get(key, b, b.ids, b.node, b.ctx, b.frames); eb.pb = lse(eb.pb, tot + pBlank);
      const last = b.ids.length ? b.ids[b.ids.length - 1] : -1;
      for (const [c, pc] of cand) {
        if (c === blank) continue;
        if (c === last) {
          // repeated symbol without a blank in between: can only collapse
          const er = get(key, b, b.ids, b.node, b.ctx, b.frames); er.pnb = lse(er.pnb, b.pnb + pc);
          // after a blank it is a new symbol
          const a = advance(b.node, b.ctx, c);
          const nk = key + ',' + c;
          const en = get(nk, b, [...b.ids, c], a.node, a.ctx, [...b.frames, t]);
          en.pnb = lse(en.pnb, b.pb + pc + a.add);
        } else {
          const a = advance(b.node, b.ctx, c);
          const nk = key + ',' + c;
          const en = get(nk, b, [...b.ids, c], a.node, a.ctx, [...b.frames, t]);
          en.pnb = lse(en.pnb, tot + pc + a.add);
        }
      }
    }
    beams = new Map([...next.entries()].sort((x, y) => lse(y[1].pb, y[1].pnb) - lse(x[1].pb, x[1].pnb)).slice(0, beam));
  }
  // at the end: refund partially matched hotwords
  let best = null, bestS = -Infinity;
  for (const b of beams.values()) { const s = lse(b.pb, b.pnb) - (b.node && !b.node.end ? b.ctx : 0); if (s > bestS) { bestS = s; best = b; } }
  // confidence: mean per-frame max probability along the best path (approximation)
  let sum = 0; for (const f of best.frames) { let m = -Infinity; for (let v = 0; v < V; v++) if (logprobs[f * V + v] > m) m = logprobs[f * V + v]; sum += m; }
  return { text: joinTokens(best.ids, tokens), conf: best.ids.length ? Math.exp(sum / best.ids.length) : 0, ids: best.ids, frames: best.frames };
}
