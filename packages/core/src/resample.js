// Any sample rate, any channel count -> 16 kHz mono Float32
export const TARGET_RATE = 16000;

export function mixToMono(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/** Stateful downsampler (keeps phase across chunks to avoid clicks at chunk boundaries) */
export class Resampler {
  constructor(inRate, outRate = TARGET_RATE) {
    this.inRate = inRate;
    this.outRate = outRate;
    this.ratio = inRate / outRate;
    this.pos = 0;
    this.prev = 0;
  }
  process(input) {
    if (this.inRate === this.outRate) return Float32Array.from(input);
    const out = [];
    const r = this.ratio;
    while (this.pos < input.length) {
      const start = Math.floor(this.pos);
      const end = Math.min(input.length, Math.floor(this.pos + r));
      let sum = 0, cnt = 0;
      for (let i = start; i < end; i++) { sum += input[i]; cnt++; }
      if (cnt === 0) {
        const a = start - 1 >= 0 ? input[start - 1] : this.prev;
        const b = input[Math.max(0, start)];
        out.push(a + (b - a) * (this.pos - start));
      } else out.push(sum / cnt);
      this.pos += r;
    }
    this.pos -= input.length;
    this.prev = input[input.length - 1] ?? this.prev;
    return Float32Array.from(out);
  }
}
