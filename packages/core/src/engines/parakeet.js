// NeMo CTC models (Parakeet Japanese 0.6B, FastConformer English, ...; sherpa-onnx exports) -- greedy decoding + missed-speech repair
import { nemoFeatures } from './fbank.js';
import { parseTokens, ctcGreedy, ctcBeamHotwords, buildHotwordTrie } from './ctc.js';

const FRAME_SEC = 0.08; // 8x subsampling × 10 ms
const PAD = 2400;       // 0.15 s of silence padded on each side: the first word is recognized more reliably when there is no pause before it

export class ParakeetCtc {
  static async create({ ort, model, tokens, sessionOptions }) {
    const p = new ParakeetCtc();
    p.ort = ort;
    p.tokens = parseTokens(tokens);
    p.session = await ort.InferenceSession.create(model, { graphOptimizationLevel: 'all', ...sessionOptions });
    return p;
  }

  /** Hotwords (glossary source terms): preferred during decoding */
  setHotwords(words, bonus = 2.0) {
    const list = (words ?? []).map(w => w.trim()).filter(Boolean);
    this.trie = list.length ? buildHotwordTrie(list, this.tokens) : null;
    this.bonus = bonus;
  }

  async _run(audio) {
    const x = new Float32Array(audio.length + PAD * 2);
    x.set(audio, PAD);
    const f = nemoFeatures(x);
    const out = await this.session.run({
      audio_signal: new this.ort.Tensor('float32', f.data, [1, 80, f.frames]),
      length: new this.ort.Tensor('int64', BigInt64Array.from([BigInt(f.frames)]), [1]),
    });
    const lp = out.logprobs;
    const r = this.trie
      ? ctcBeamHotwords(lp.data, lp.dims[1], lp.dims[2], this.tokens, { trie: this.trie, bonus: this.bonus })
      : ctcGreedy(lp.data, lp.dims[1], lp.dims[2], this.tokens);
    r.times = r.frames.map(t => t * FRAME_SEC - PAD / 16000); // token times (seconds, relative to the start of audio)
    return r;
  }

  /**
   * @param {Float32Array} audio 16 kHz mono
   * @param {{chunkSec?:number}} [o] long segments are cut at pauses into <= chunkSec pieces
   *     (re-tested on real speech: 12 s is best; 8 s cuts words in half, TV CER 10.7% -> 12.0%)
   */
  async transcribe(audio, { chunkSec = 12 } = {}) {
    const cuts = chunkSec ? pauseCuts(audio, chunkSec) : [];
    if (!cuts.length) return this._run(audio);
    const bounds = [0, ...cuts, audio.length];
    let text = '', logConf = 0, n = 0;
    for (let i = 0; i < bounds.length - 1; i++) {
      const r = await this._run(audio.subarray(bounds[i], bounds[i + 1]));
      if (!r.ids.length) continue;
      // the model ends every piece with '。'; drop it on inner pieces so the sentence isn't broken up
      const t = i < bounds.length - 2 ? r.text.replace(/[。．]$/, '') : r.text;
      text += (text && /[A-Za-z0-9]$/.test(text) && /^[A-Za-z0-9]/.test(t) ? ' ' : '') + t;
      logConf += Math.log(r.conf || 1e-9) * r.ids.length; n += r.ids.length;
    }
    return { text, conf: n ? Math.exp(logConf / n) : 0, chunks: bounds.length - 1 };
  }
}

/** Find cut points (sample indices) at pauses so that each piece is <= maxSec; no cut without a suitable pause */
export function pauseCuts(audio, maxSec, minPauseFrames = 8) {
  const win = 320, n = Math.floor(audio.length / win);
  if (audio.length <= maxSec * 16000) return [];
  const db = new Float32Array(n); let max = -120;
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * win; j < (i + 1) * win; j++) s += audio[j] * audio[j]; db[i] = 10 * Math.log10(s / win + 1e-12); if (db[i] > max) max = db[i]; }
  const th = max - 30;
  // candidates: centers of pauses of >= 8 frames (160 ms) below the threshold, with their length
  const pauses = [];
  for (let i = 0; i < n;) { if (db[i] < th) { let j = i; while (j < n && db[j] < th) j++; if (j - i >= minPauseFrames && i > 0 && j < n) pauses.push({ at: ((i + j) >> 1) * win, len: j - i }); i = j; } else i++; }
  const cuts = []; let last = 0;
  const maxS = maxSec * 16000, minS = 1.5 * 16000;
  while (audio.length - last > maxS) {
    // pick the longest pause within [last+minS, last+maxS]
    const c = pauses.filter(p => p.at > last + minS && p.at <= last + maxS).sort((a, b) => b.len - a.len)[0];
    if (!c) { const nxt = pauses.find(p => p.at > last + maxS); if (!nxt || audio.length - nxt.at < minS) break; cuts.push(nxt.at); last = nxt.at; continue; }
    cuts.push(c.at); last = c.at;
  }
  return cuts.filter(c => audio.length - c >= minS);
}
