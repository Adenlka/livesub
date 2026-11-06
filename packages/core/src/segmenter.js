// Energy-based speech segmenter (tuned for live streams: BGM, short pauses)
// Input: 16 kHz mono Float32; output: onPartial / onFinal callbacks
const FRAME = 320; // 20ms @16k

export class SpeechSegmenter {
  constructor(opts = {}) {
    this.rate = 16000;
    this.silenceMs = opts.silenceMs ?? 550;      // Pauses between Japanese sentences are short
    this.minSpeechMs = opts.minSpeechMs ?? 250;
    this.maxSegmentMs = opts.maxSegmentMs ?? 9000;
    this.partialMs = opts.partialIntervalMs ?? 1000;
    this.preRollMs = opts.preRollMs ?? 240;
    this.onPartial = opts.onPartial ?? (() => {});
    this.onFinal = opts.onFinal ?? (() => {});
    this.onLevel = opts.onLevel ?? null;

    this.noise = 0.004;
    this.carry = new Float32Array(0);
    this.preRoll = [];
    this.frames = [];       // Frames of the current speech segment
    this.energies = [];     // RMS of each frame
    this.inSpeech = false;
    this.silenceRun = 0;
    this.speechRun = 0;
    this.sinceLastPartial = 0;
    this.nextId = 1;
    this.curId = 0;
    this.totalFrames = 0; // Number of frames processed (for subtitle timestamps)
    this.startFrame = 0;
  }

  get frameMs() { return FRAME / this.rate * 1000; }

  push(samples) {
    let buf = samples;
    if (this.carry.length) {
      buf = new Float32Array(this.carry.length + samples.length);
      buf.set(this.carry); buf.set(samples, this.carry.length);
    }
    let off = 0;
    for (; off + FRAME <= buf.length; off += FRAME) this._frame(buf.slice(off, off + FRAME));
    this.carry = buf.slice(off);
  }

  _threshold() { return Math.max(this.noise * 2.8, 0.006); }

  _frame(f) {
    this.totalFrames++;
    let s = 0;
    for (let i = 0; i < f.length; i++) s += f[i] * f[i];
    const rms = Math.sqrt(s / f.length);
    const voiced = rms > this._threshold();
    if (this.onLevel) this.onLevel(rms, voiced);

    if (!this.inSpeech) {
      // Noise-floor tracking (updated only outside speech)
      this.noise = Math.max(0.0005, this.noise * 0.97 + rms * 0.03);
      this.preRoll.push({ f, rms });
      const maxPre = Math.ceil(this.preRollMs / this.frameMs);
      while (this.preRoll.length > maxPre) this.preRoll.shift();
      this.speechRun = voiced ? this.speechRun + 1 : 0;
      if (this.speechRun * this.frameMs >= 60) this._begin();
      return;
    }

    this.frames.push(f); this.energies.push(rms);
    this.silenceRun = voiced ? 0 : this.silenceRun + 1;
    this.sinceLastPartial += this.frameMs;

    const lenMs = this.frames.length * this.frameMs;
    if (this.silenceRun * this.frameMs >= this.silenceMs) {
      this._end(this.frames.length - Math.max(0, this.silenceRun - 8)); // Keep a 160 ms tail
      return;
    }
    if (lenMs >= this.maxSegmentMs) { this._forceCut(); return; }
    if (this.sinceLastPartial >= this.partialMs && lenMs >= 700) {
      this.sinceLastPartial = 0;
      this.onPartial({ id: this.curId, audio: this._concat(this.frames) });
    }
  }

  _begin(initFrames = null, initE = null) {
    this.inSpeech = true;
    this.curId = this.nextId++;
    this.frames = initFrames ?? this.preRoll.map(p => p.f);
    this.startFrame = this.totalFrames - this.frames.length;
    this.energies = initE ?? this.preRoll.map(p => p.rms);
    this.preRoll = [];
    this.silenceRun = 0;
    this.sinceLastPartial = 0;
  }

  _end(keepFrames) {
    const frames = this.frames.slice(0, keepFrames);
    const voicedMs = this.energies.filter(e => e > this._threshold()).length * this.frameMs;
    const id = this.curId;
    const startMs = this.startFrame * this.frameMs, endMs = startMs + frames.length * this.frameMs;
    this.inSpeech = false;
    this.frames = []; this.energies = [];
    this.speechRun = 0;
    if (voicedMs >= this.minSpeechMs) this.onFinal({ id, audio: this._concat(frames), startMs, endMs });
    else this.onFinal({ id, audio: null }); // too short: tell the caller to withdraw this segment's partial caption
  }

  // Max length reached: cut at the lowest-energy point within the last 2.5 s (try not to cut a word)
  _forceCut() {
    const n = this.frames.length;
    const look = Math.min(n - 1, Math.ceil(2500 / this.frameMs));
    let best = n - 1, bestE = Infinity;
    for (let i = n - look; i < n; i++) {
      // Smooth with a 3-frame window
      const e = (this.energies[i - 1] ?? 0) + this.energies[i] + (this.energies[i + 1] ?? 0);
      if (e < bestE) { bestE = e; best = i; }
    }
    const restF = this.frames.slice(best);
    const restE = this.energies.slice(best);
    const id = this.curId;
    const audio = this._concat(this.frames.slice(0, best));
    const startMs = this.startFrame * this.frameMs;
    this.onFinal({ id, audio, startMs, endMs: startMs + best * this.frameMs });
    this._begin(restF, restE);
  }

  /** Flush remaining speech when stopped externally */
  flush() {
    if (this.inSpeech) this._end(this.frames.length);
  }

  _concat(frames) {
    const out = new Float32Array(frames.length * FRAME);
    frames.forEach((f, i) => out.set(f, i * FRAME));
    return out;
  }
}
