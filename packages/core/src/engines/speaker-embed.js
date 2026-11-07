// 3D-Speaker ERes2Net speaker embedding (512-d)
import { speakerFeatures } from './fbank.js';

export class SpeakerEmbedder {
  static async create({ ort, model, sessionOptions }) {
    const s = new SpeakerEmbedder();
    s.ort = ort;
    s.session = await ort.InferenceSession.create(model, sessionOptions);
    return s;
  }
  /** Use only the middle 8 s of long audio (voiceprints stabilize within seconds; saves compute) */
  async embed(audio) {
    const max = 16000 * 8;
    const a = audio.length > max ? audio.subarray((audio.length - max) >> 1, ((audio.length - max) >> 1) + max) : audio;
    const f = speakerFeatures(a);
    const out = await this.session.run({ x: new this.ort.Tensor('float32', f.data, [1, f.frames, 80]) });
    return Float32Array.from(out.embedding.data);
  }
}
