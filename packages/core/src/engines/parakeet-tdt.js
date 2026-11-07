// NVIDIA Parakeet-TDT 0.6B v2 (English; sherpa-onnx encoder/decoder/joiner export) -- TDT greedy decoding
// Measured on real speech: AMI meetings 10.8% WER, YouTube 12.1%, clearly better than SenseVoice (15.3% / 16.4%)
import { nemoFeatures } from './fbank.js';
import { parseTokens } from './ctc.js';
import { pauseCuts } from './parakeet.js';

const PAD = 4800; // 0.3 s of silence on each side

export class ParakeetTdt {
  static async create({ ort, encoder, decoder, joiner, tokens, sessionOptions }) {
    const p = new ParakeetTdt();
    p.ort = ort;
    p.tokens = parseTokens(tokens);
    p.vocab = p.tokens.length;          // includes <blk> (the last one)
    p.blank = p.vocab - 1;
    const o = { graphOptimizationLevel: 'all', ...sessionOptions };
    [p.enc, p.dec, p.join] = await Promise.all([encoder, decoder, joiner].map(m => ort.InferenceSession.create(m, o)));
    p.nMels = 128; p.hidden = 640; p.layers = 2;
    return p;
  }
  setHotwords() { /* TDT greedy decoding has no hotword support yet */ }

  async _decoder(token, states) {
    const T = this.ort.Tensor;
    const r = await this.dec.run({
      targets: new T('int32', Int32Array.from([token]), [1, 1]),
      target_length: new T('int32', Int32Array.from([1]), [1]),
      [this.dec.inputNames[2]]: states[0],
      [this.dec.inputNames[3]]: states[1],
    });
    return { out: r[this.dec.outputNames[0]].data, states: [r[this.dec.outputNames[2]], r[this.dec.outputNames[3]]] };
  }

  async _run(audio) {
    const T = this.ort.Tensor;
    const x = new Float32Array(audio.length + PAD * 2); x.set(audio, PAD);
    const f = nemoFeatures(x, this.nMels);
    const e = await this.enc.run({
      audio_signal: new T('float32', f.data, [1, this.nMels, f.frames]),
      length: new T('int64', BigInt64Array.from([BigInt(f.frames)]), [1]),
    });
    const eo = e.outputs, D = eo.dims[1], Tall = eo.dims[2], Tn = Number(e.encoded_lengths.data[0]);
    const zeros = () => new T('float32', new Float32Array(this.layers * this.hidden), [this.layers, 1, this.hidden]);
    let d = await this._decoder(this.blank, [zeros(), zeros()]);
    const frame = new Float32Array(D);
    const ids = []; let sum = 0, perFrame = 0;
    for (let t = 0; t < Tn;) {
      for (let k = 0; k < D; k++) frame[k] = eo.data[k * Tall + t];
      const j = await this.join.run({
        encoder_outputs: new T('float32', frame, [1, D, 1]),
        decoder_outputs: new T('float32', d.out, [1, this.hidden, 1]),
      });
      const lg = j.outputs.data;
      let y = 0, yv = -Infinity;
      for (let v = 0; v < this.vocab; v++) if (lg[v] > yv) { yv = lg[v]; y = v; }
      let skip = 0, sv = -Infinity;
      for (let v = this.vocab; v < lg.length; v++) if (lg[v] > sv) { sv = lg[v]; skip = v - this.vocab; }
      if (y !== this.blank) {
        let m = -Infinity; for (let v = 0; v < this.vocab; v++) if (lg[v] > m) m = lg[v];
        let s = 0; for (let v = 0; v < this.vocab; v++) s += Math.exp(lg[v] - m);
        sum += yv - m - Math.log(s);
        ids.push(y);
        d = await this._decoder(y, d.states);
        perFrame++;
      }
      if (skip > 0) perFrame = 0;
      if (perFrame >= 5) { perFrame = 0; skip = 1; }
      if (y === this.blank && skip === 0) { perFrame = 0; skip = 1; }
      t += skip;
    }
    const text = ids.map(i => this.tokens[i] ?? '').join('').replace(/▁/g, ' ').replace(/\s+/g, ' ').trim();
    return { text, conf: ids.length ? Math.exp(sum / ids.length) : 0, n: ids.length };
  }

  /** Long segments are cut at pauses into <= chunkSec pieces (same strategy as the Japanese Parakeet) */
  async transcribe(audio, { chunkSec = 15 } = {}) {
    const cuts = chunkSec ? pauseCuts(audio, chunkSec) : [];
    const bounds = [0, ...cuts, audio.length];
    let text = '', lc = 0, n = 0;
    for (let i = 0; i < bounds.length - 1; i++) {
      const r = await this._run(audio.subarray(bounds[i], bounds[i + 1]));
      if (!r.n) continue;
      text += (text ? ' ' : '') + r.text;
      lc += Math.log(r.conf || 1e-9) * r.n; n += r.n;
    }
    return { text, conf: n ? Math.exp(lc / n) : 0 };
  }
}
