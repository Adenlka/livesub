// SenseVoice-Small (Alibaba FunAudioLLM; zh/en/ja/ko/yue; sherpa-onnx export) -- CTC with built-in punctuation, number normalization and per-sentence language ID
import { senseVoiceFeatures } from './fbank.js';
import { parseTokens, ctcBeamHotwords, buildHotwordTrie } from './ctc.js';

export const SV_LANG_ID = { auto: 0, zh: 3, en: 4, yue: 7, ja: 11, ko: 12 };

export class SenseVoice {
  /** @param {{ort:any, model:Uint8Array|string, tokens:string, meta?:{negMean:Float32Array, invStd:Float32Array}}} o */
  static async create({ ort, model, tokens, cmvn, sessionOptions }) {
    const s = new SenseVoice();
    s.ort = ort;
    s.tokens = parseTokens(tokens);
    s.session = await ort.InferenceSession.create(model, { graphOptimizationLevel: 'all', ...sessionOptions });
    // CMVN normally lives in the model metadata, which onnxruntime-web can't read -> ship sensevoice-cmvn.json instead
    s.negMean = Float32Array.from(cmvn.negMean);
    s.invStd = Float32Array.from(cmvn.invStd);
    return s;
  }

  setHotwords(words, bonus = 2.5) {
    const list = (words ?? []).map(w => w.trim()).filter(Boolean);
    this.trie = list.length ? buildHotwordTrie(list, this.tokens) : null;
    this.bonus = bonus;
  }

  /** @param {Float32Array} audio 16kHz  @param {string} lang auto|zh|en|ja|ko|yue */
  async transcribe(audio, lang = 'auto') {
    const pad = 2400;
    const x = new Float32Array(audio.length + pad * 2); x.set(audio, pad);
    const f = senseVoiceFeatures(x, this.negMean, this.invStd);
    if (!f.frames) return { text: '', conf: 0, lang: null };
    const T = this.ort.Tensor;
    const out = await this.session.run({
      x: new T('float32', f.data, [1, f.frames, 560]),
      x_length: new T('int32', Int32Array.from([f.frames]), [1]),
      language: new T('int32', Int32Array.from([SV_LANG_ID[lang] ?? 0]), [1]),
      text_norm: new T('int32', Int32Array.from([14]), [1]), // 14 = with_itn (punctuation, Arabic digits)
    });
    const lg = out.logits, Tn = lg.dims[1], V = lg.dims[2];
    // logits -> log-softmax (needed for confidence and beam search)
    const d = new Float32Array(lg.data.length);
    for (let t = 0; t < Tn; t++) { const z = logSumExp(lg.data, t * V, V); for (let v = 0; v < V; v++) d[t * V + v] = lg.data[t * V + v] - z; }
    let toks, sum = 0, n = 0;
    if (this.trie) {
      const r = ctcBeamHotwords(d, Tn, V, this.tokens, { blank: 0, trie: this.trie, bonus: this.bonus });
      toks = r.ids; sum = Math.log(r.conf || 1e-9); n = 1;
    } else {
      let prev = -1; toks = [];
      for (let t = 0; t < Tn; t++) {
        let best = 0, bv = -Infinity; const o = t * V;
        for (let v = 0; v < V; v++) if (d[o + v] > bv) { bv = d[o + v]; best = v; }
        if (best !== 0 && best !== prev) { toks.push(best); if (toks.length > 4) { sum += bv; n++; } }
        prev = best;
      }
    }
    const tags = toks.slice(0, 4).map(i => this.tokens[i]);
    const detected = tags.map(t => /^<\|(zh|en|ja|ko|yue)\|>$/.exec(t ?? '')?.[1]).find(Boolean) ?? null;
    const text = toks.slice(4).map(i => this.tokens[i]).join('').replace(/▁/g, ' ').replace(/<\|[^|]*\|>/g, '').replace(/\s+/g, ' ').trim();
    return { text, conf: n ? Math.exp(sum / n) : 0, lang: detected };
  }
}

function logSumExp(d, o, V) {
  let m = -Infinity; for (let v = 0; v < V; v++) if (d[o + v] > m) m = d[o + v];
  let s = 0; for (let v = 0; v < V; v++) s += Math.exp(d[o + v] - m);
  return m + Math.log(s);
}
