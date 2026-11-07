// AudioWorklet: batch 128-frame blocks into ~2048 frames before posting to the main thread (fewer messages)
class LsCapture extends AudioWorkletProcessor {
  constructor() { super(); this.size = 2048; this.bufs = null; this.n = 0; }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    if (!this.bufs || this.bufs.length !== input.length) { this.bufs = input.map(() => new Float32Array(this.size)); this.n = 0; }
    const len = input[0].length;
    for (let c = 0; c < input.length; c++) this.bufs[c].set(input[c], this.n);
    this.n += len;
    if (this.n + len > this.size) {
      const out = this.bufs.map(b => b.slice(0, this.n));
      this.port.postMessage(out, out.map(b => b.buffer));
      this.n = 0;
    }
    return true;
  }
}
registerProcessor('ls-capture', LsCapture);
