// Speech segmenter: Silero VAD (recommended) or an energy threshold (fallback)
// Input 16 kHz mono; output onPartial (while speaking, periodically) / onFinal (end of a sentence)
export const FRAME = 512; // 32 ms, matches the Silero VAD window
const FRAME_MS = FRAME / 16;

export class SpeechSegmenter {
  /**
   * @param {object} o
   * @param {{prob:(f:Float32Array)=>Promise<number>, reset?:()=>void}} [o.vad] falls back to the energy threshold when absent
   */
  constructor(o = {}) {
    this.vad = o.vad ?? null;
    this.silenceMs = o.silenceMs ?? 550;
    this.minSpeechMs = o.minSpeechMs ?? 250;
    this.maxSegmentMs = o.maxSegmentMs ?? 9000;
    this.partialMs = o.partialIntervalMs ?? 1000;
    this.preRollMs = o.preRollMs ?? 256;
    this.startProb = o.startProb ?? 0.5;   // probability threshold to enter speech
    this.endProb = o.endProb ?? 0.35;      // threshold to stay in speech (hysteresis, avoids flicker mid-sentence)
    this.onPartial = o.onPartial ?? (() => {});
    this.onFinal = o.onFinal ?? (() => {});
    this.onLevel = o.onLevel ?? null;

    this.noise = 0.004;
    this.carry = new Float32Array(0);
    this.preRoll = [];
    this.frames = []; this.scores = []; this.energies = [];
    this.inSpeech = false;
    this.silenceRun = 0; this.speechRun = 0; this.sinceLastPartial = 0;
    this.nextId = 1; this.curId = 0;
    this.totalFrames = 0; this.startFrame = 0;
    this.chain = Promise.resolve();
  }

  get frameMs() { return FRAME_MS; }

  /** Push audio (any length). The returned promise resolves once this chunk is processed */
  push(samples) {
    this.chain = this.chain.then(() => this._process(samples));
    return this.chain;
  }

  async _process(samples) {
    let buf = samples;
    if (this.carry.length) {
      buf = new Float32Array(this.carry.length + samples.length);
      buf.set(this.carry); buf.set(samples, this.carry.length);
    }
    let off = 0;
    for (; off + FRAME <= buf.length; off += FRAME) {
      const f = buf.slice(off, off + FRAME);
      let s = 0; for (let i = 0; i < FRAME; i++) s += f[i] * f[i];
      const rms = Math.sqrt(s / FRAME);
      let score; // 0..1: how speech-like
      if (this.vad) {
        try { score = await this.vad.prob(f); } catch { this.vad = null; }
      }
      if (score === undefined) score = this._energyScore(rms);
      this._frame(f, rms, score);
    }
    this.carry = buf.slice(off);
  }

  // Energy mode: map RMS to a 0..1 'score' so it shares the VAD threshold logic
  _energyScore(rms) {
    const th = Math.max(this.noise * 2.8, 0.006);
    if (!this.inSpeech) this.noise = Math.max(0.0005, this.noise * 0.97 + rms * 0.03);
    return Math.min(1, rms / th * 0.5); // rms == th → 0.5
  }

  _frame(f, rms, score) {
    this.totalFrames++;
    const voiced = score >= (this.inSpeech ? this.endProb : this.startProb);
    this.onLevel?.(rms, voiced);

    if (!this.inSpeech) {
      this.preRoll.push({ f, score, rms });
      const maxPre = Math.ceil(this.preRollMs / FRAME_MS);
      while (this.preRoll.length > maxPre) this.preRoll.shift();
      this.speechRun = voiced ? this.speechRun + 1 : 0;
      if (this.speechRun * FRAME_MS >= 64) this._begin();
      return;
    }

    this.frames.push(f); this.scores.push(score); this.energies.push(rms);
    this.silenceRun = voiced ? 0 : this.silenceRun + 1;
    this.sinceLastPartial += FRAME_MS;

    const lenMs = this.frames.length * FRAME_MS;
    if (this.silenceRun * FRAME_MS >= this.silenceMs) {
      this._end(this.frames.length - Math.max(0, this.silenceRun - 6)); // keep ~190 ms of trailing audio
      return;
    }
    if (lenMs >= this.maxSegmentMs) { this._forceCut(); return; }
    if (this.sinceLastPartial >= this.partialMs && lenMs >= 700) {
      this.sinceLastPartial = 0;
      this.onPartial({ id: this.curId, audio: concat(this.frames), startMs: this.startFrame * FRAME_MS });
    }
  }

  _begin(initFrames = null, initS = null, initE = null) {
    this.inSpeech = true;
    this.curId = this.nextId++;
    this.frames = initFrames ?? this.preRoll.map(p => p.f);
    this.scores = initS ?? this.preRoll.map(p => p.score);
    this.energies = initE ?? this.preRoll.map(p => p.rms);
    this.startFrame = this.totalFrames - this.frames.length;
    this.preRoll = [];
    this.silenceRun = 0;
    this.sinceLastPartial = 0;
  }

  _end(keepFrames) {
    const frames = this.frames.slice(0, keepFrames);
    const scores = Float32Array.from(this.scores.slice(0, keepFrames));
    const voicedMs = this.scores.filter(s => s >= this.endProb).length * FRAME_MS;
    const id = this.curId;
    const startMs = this.startFrame * FRAME_MS, endMs = startMs + frames.length * FRAME_MS;
    this.inSpeech = false;
    this.frames = []; this.scores = []; this.energies = [];
    this.speechRun = 0;
    this.vad?.reset?.();
    if (voicedMs >= this.minSpeechMs) this.onFinal({ id, audio: concat(frames), scores, startMs, endMs });
    else this.onFinal({ id, audio: null, startMs, endMs }); // too short: tell the caller to withdraw this segment's partial caption
  }

  // Max length reached: cut at the least speech-like, lowest-energy point within the last 3 s, trying not to split a word
  _forceCut() {
    const n = this.frames.length;
    const look = Math.min(n - 2, Math.ceil(3000 / FRAME_MS));
    const maxE = Math.max(...this.energies.slice(n - look)) || 1;
    let best = n - 1, bestV = Infinity;
    for (let i = n - look; i < n - 1; i++) {
      const v = (this.scores[i - 1] + this.scores[i] + this.scores[i + 1]) / 3 + 0.5 * this.energies[i] / maxE;
      if (v < bestV) { bestV = v; best = i; }
    }
    const id = this.curId;
    const startMs = this.startFrame * FRAME_MS;
    const audio = concat(this.frames.slice(0, best));
    const scores = Float32Array.from(this.scores.slice(0, best));
    const rest = [this.frames.slice(best), this.scores.slice(best), this.energies.slice(best)];
    this.onFinal({ id, audio, scores, startMs, endMs: startMs + best * FRAME_MS, cut: true });
    this._begin(...rest);
  }

  /** Flush remaining speech when stopped externally */
  flush() {
    return this.chain = this.chain.then(() => { if (this.inSpeech) this._end(this.frames.length); });
  }
}

function concat(frames) {
  const out = new Float32Array(frames.length * FRAME);
  frames.forEach((f, i) => out.set(f, i * FRAME));
  return out;
}
