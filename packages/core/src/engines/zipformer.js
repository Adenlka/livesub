// k2/icefall Zipformer models (sherpa-onnx exports)
//     ZipformerCtc        -- Chinese CTC (2025-07-03, trained on WenetSpeech etc., byte-level BPE vocabulary)
//     ZipformerTransducer -- RNN-T (used for Korean, 2024-06-24)
// Features: 80-dim kaldi fbank (povey window, DC removal, 20-7600 Hz, samples kept in [-1,1]), no normalization
import { logMel } from './fbank.js';
import { parseTokens, ctcGreedy, ctcBeamHotwords, buildHotwordTrie } from './ctc.js';
import { BBPE_TABLE } from './bbpe-table.js';

const PAD = 4800; // 0.3 s of silence padded on each side so the first character isn't lost when speech starts right at the edge

function features(audio) {
  const x = new Float32Array(audio.length + PAD * 2);
  x.set(audio, PAD);
  return logMel(x, 'speaker', 80);
}

/** Byte-level BPE: token characters -> bytes -> UTF-8 */
export function decodeBbpe(pieces) {
  const bytes = [];
  for (const ch of pieces.join('')) {
    if (ch === '▁') { const b = bytes[bytes.length - 1]; if (bytes.length && b !== 32 && b < 128) bytes.push(32); continue; }
    const v = BBPE_TABLE[ch];
    if (v !== undefined) bytes.push(v);
    else for (const c of new TextEncoder().encode(ch)) bytes.push(c);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes)).replace(/�/g, '').trim();
}
const isBbpeVocab = (tokens) => tokens.slice(3, 40).filter(Boolean).every(t => [...t.replace(/▁/g, '')].every(c => BBPE_TABLE[c] !== undefined || c === ''));
const encodeBbpe = (word) => [...new TextEncoder().encode(word)].map(b => BBPE_REV[b]).join('');
const BBPE_REV = []; for (const [k, v] of Object.entries(BBPE_TABLE)) if (BBPE_REV[v] === undefined && k !== '⁇') BBPE_REV[v] = k;

export class ZipformerCtc {
  static async create({ ort, model, tokens, sessionOptions }) {
    const z = new ZipformerCtc();
    z.ort = ort;
    z.tokens = parseTokens(tokens);
    z.bbpe = isBbpeVocab(z.tokens);
    z.session = await ort.InferenceSession.create(model, { graphOptimizationLevel: 'all', ...sessionOptions });
    return z;
  }
  setHotwords(words, bonus = 2.5) {
    const list = (words ?? []).map(w => w.trim()).filter(Boolean);
    // byte-level vocabulary: convert hotwords to the same byte characters, then longest-match tokens
    this.trie = list.length ? buildHotwordTrie(this.bbpe ? list.map(encodeBbpe) : list, this.tokens) : null;
    this.bonus = bonus;
  }
  async transcribe(audio) {
    const f = features(audio);
    const T = this.ort.Tensor;
    const out = await this.session.run({
      x: new T('float32', f.feats, [1, f.frames, 80]),
      x_lens: new T('int64', BigInt64Array.from([BigInt(f.frames)]), [1]),
    });
    const lp = out.log_probs, Tn = Number(out.log_probs_len.data[0]), V = lp.dims[2];
    const r = this.trie
      ? ctcBeamHotwords(lp.data, Tn, V, this.tokens, { blank: 0, trie: this.trie, bonus: this.bonus })
      : ctcGreedy(lp.data, Tn, V, this.tokens, 0);
    const pieces = r.ids.map(i => this.tokens[i] ?? '').filter(t => !/^<.*>$/.test(t));
    const text = this.bbpe ? decodeBbpe(pieces) : pieces.join('').replace(/▁/g, ' ').trim();
    return { text, conf: r.conf };
  }
}

export class ZipformerTransducer {
  static async create({ ort, encoder, decoder, joiner, tokens, sessionOptions }) {
    const z = new ZipformerTransducer();
    z.ort = ort;
    z.tokens = parseTokens(tokens);
    const o = { graphOptimizationLevel: 'all', ...sessionOptions };
    [z.enc, z.dec, z.join] = await Promise.all([encoder, decoder, joiner].map(m => ort.InferenceSession.create(m, o)));
    z.context = 2; z.blank = 0;
    return z;
  }
  setHotwords() { /* greedy RNN-T has no hotword support yet */ }
  async _decoder(ctx) {
    const T = this.ort.Tensor;
    const r = await this.dec.run({ y: new T('int64', BigInt64Array.from(ctx.map(BigInt)), [1, this.context]) });
    return r.decoder_out.data;
  }
  async transcribe(audio) {
    const f = features(audio);
    const T = this.ort.Tensor;
    const e = await this.enc.run({
      x: new T('float32', f.feats, [1, f.frames, 80]),
      x_lens: new T('int64', BigInt64Array.from([BigInt(f.frames)]), [1]),
    });
    const eo = e.encoder_out, Tn = Number(e.encoder_out_lens.data[0]), D = eo.dims[2];
    const hyp = Array(this.context).fill(this.blank);
    let dout = await this._decoder(hyp.slice(-this.context));
    const ids = []; let sum = 0;
    for (let t = 0; t < Tn; t++) {
      // at most one token per frame (same as sherpa-onnx greedy decoding)
      const j = await this.join.run({
        encoder_out: new T('float32', eo.data.subarray(t * D, (t + 1) * D), [1, D]),
        decoder_out: new T('float32', dout, [1, dout.length]),
      });
      const lg = j.logit.data; let best = 0, bv = -Infinity;
      for (let v = 0; v < lg.length; v++) if (lg[v] > bv) { bv = lg[v]; best = v; }
      if (best !== this.blank) {
        let m = -Infinity; for (let v = 0; v < lg.length; v++) if (lg[v] > m) m = lg[v];
        let s = 0; for (let v = 0; v < lg.length; v++) s += Math.exp(lg[v] - m);
        sum += bv - m - Math.log(s);
        ids.push(best); hyp.push(best);
        dout = await this._decoder(hyp.slice(-this.context));
      }
    }
    const text = ids.map(i => this.tokens[i] ?? '').filter(t => !/^<.*>$/.test(t)).join('').replace(/▁/g, ' ').trim();
    return { text, conf: ids.length ? Math.exp(sum / ids.length) : 0 };
  }
}
