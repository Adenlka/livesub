// Silero VAD v4 (sherpa-onnx export, 16 kHz branch only): one speech probability per 512 samples (32 ms)
export const VAD_FRAME = 512;

export class SileroVad {
  /** @param {{ort:any, model:Uint8Array|string}} o */
  static async create({ ort, model, sessionOptions }) {
    const v = new SileroVad();
    v.ort = ort;
    v.session = await ort.InferenceSession.create(model, { ...sessionOptions });
    v.reset();
    return v;
  }
  reset() {
    const z = () => new this.ort.Tensor('float32', new Float32Array(2 * 64), [2, 1, 64]);
    this.h = z(); this.c = z();
  }
  /** @param {Float32Array} frame length 512 */
  async prob(frame) {
    const out = await this.session.run({ x: new this.ort.Tensor('float32', frame, [1, VAD_FRAME]), h: this.h, c: this.c });
    this.h = out.new_h; this.c = out.new_c;
    return out.prob.data[0];
  }
}
