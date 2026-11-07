// Generic log-mel filterbank (matches kaldi-native-fbank)
// Presets:
//     nemo       -- Parakeet / NeMo CTC: hann window, no DC removal, librosa (slaney) mel, log(x+2^-24), per-feature normalization
//     speaker    -- 3D-Speaker embeddings: povey window, DC removal, HTK mel 20-7600 Hz, log(max(x,eps)), global mean normalization
//     sensevoice -- SenseVoice: hamming window, DC removal, HTK mel 20-8000 Hz, snip_edges, samples scaled to int16 range
const SR = 16000, WIN = 400, HOP = 160, NFFT = 512, NBIN = NFFT / 2 + 1;

export const PRESETS = {
  nemo: { window: 'hann', removeDc: false, mel: 'slaney', lowFreq: 0, highFreq: 8000, snipEdges: false, scale: 1, logAdd: true },
  speaker: { window: 'povey', removeDc: true, mel: 'htk', lowFreq: 20, highFreq: 7600, snipEdges: false, scale: 1, logAdd: false },
  sensevoice: { window: 'hamming', removeDc: true, mel: 'htk', lowFreq: 20, highFreq: 8000, snipEdges: true, scale: 32768, logAdd: false },
};

const slaney = {
  toMel(f) { const fsp = 200 / 3, minLogHz = 1000, minLogMel = minLogHz / fsp, ls = Math.log(6.4) / 27; return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / ls : f / fsp; },
  toHz(m) { const fsp = 200 / 3, minLogHz = 1000, minLogMel = minLogHz / fsp, ls = Math.log(6.4) / 27; return m >= minLogMel ? minLogHz * Math.exp(ls * (m - minLogMel)) : fsp * m; },
};
const htkMel = (f) => 1127 * Math.log(1 + f / 700);

const cache = new Map();
function setup(p, nMels) {
  const key = JSON.stringify(p) + nMels;
  if (cache.has(key)) return cache.get(key);
  const fb = [];
  if (p.mel === 'slaney') {
    const mLo = slaney.toMel(p.lowFreq), mHi = slaney.toMel(p.highFreq);
    const melF = Float64Array.from({ length: nMels + 2 }, (_, i) => slaney.toHz(mLo + (mHi - mLo) * i / (nMels + 1)));
    for (let m = 0; m < nMels; m++) {
      const lo = melF[m], c = melF[m + 1], hi = melF[m + 2], enorm = 2 / (hi - lo);
      fb.push(tri(k => { const f = k * SR / NFFT; return Math.max(0, Math.min((f - lo) / (c - lo), (hi - f) / (hi - c))) * enorm; }));
    }
  } else {
    const lo = htkMel(p.lowFreq), hi = htkMel(p.highFreq), d = (hi - lo) / (nMels + 1);
    for (let m = 0; m < nMels; m++) {
      const l = lo + m * d, c = l + d, r = c + d;
      fb.push(tri(k => {
        if (k >= NFFT / 2) return 0; // kaldi skips the Nyquist bin
        const mel = htkMel(k * SR / NFFT);
        if (mel <= l || mel >= r) return 0;
        return mel <= c ? (mel - l) / (c - l) : (r - mel) / (r - c);
      }));
    }
  }
  const win = Float64Array.from({ length: WIN }, (_, i) => {
    const a = 2 * Math.PI * i / (WIN - 1);
    if (p.window === 'hamming') return 0.54 - 0.46 * Math.cos(a);
    const h = 0.5 - 0.5 * Math.cos(a);
    return p.window === 'povey' ? Math.pow(h, 0.85) : h;
  });
  const tw = { cos: new Float64Array(NFFT / 2), sin: new Float64Array(NFFT / 2) };
  for (let i = 0; i < NFFT / 2; i++) { tw.cos[i] = Math.cos(-2 * Math.PI * i / NFFT); tw.sin[i] = Math.sin(-2 * Math.PI * i / NFFT); }
  const rev = new Uint16Array(NFFT);
  for (let i = 0; i < NFFT; i++) { let r = 0; for (let b = 0; b < 9; b++) r |= ((i >> b) & 1) << (8 - b); rev[i] = r; }
  const res = { fb, win, tw, rev };
  cache.set(key, res);
  return res;
}
function tri(fn) {
  const w = new Float32Array(NBIN); let first = -1, last = -1;
  for (let k = 0; k < NBIN; k++) { const v = fn(k); w[k] = v; if (v > 0) { if (first < 0) first = k; last = k; } }
  return { w, first: Math.max(first, 0), last };
}

function fft(re, im, tw, rev) {
  const n = re.length;
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) for (let k = 0; k < half; k++) {
      const c = tw.cos[k * step], d = tw.sin[k * step], a = s + k, b = a + half;
      const xr = re[b] * c - im[b] * d, xi = re[b] * d + im[b] * c;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}

/** Raw log-mel, shape [T, nMels] (time-major) */
export function logMel(samples, preset = 'nemo', nMels = 80) {
  const p = typeof preset === 'string' ? PRESETS[preset] : preset;
  const { fb, win, tw, rev } = setup(p, nMels);
  const N = samples.length;
  const T = p.snipEdges ? (N < WIN ? 0 : 1 + Math.floor((N - WIN) / HOP)) : Math.max(1, Math.floor((N + HOP / 2) / HOP));
  const feats = new Float32Array(T * nMels);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), fr = new Float64Array(WIN);
  for (let t = 0; t < T; t++) {
    const start = p.snipEdges ? t * HOP : t * HOP + HOP / 2 - WIN / 2;
    for (let i = 0; i < WIN; i++) {
      let s = start + i;
      if (s < 0) s = -s - 1; else if (s >= N) s = 2 * N - 1 - s;
      fr[i] = samples[Math.min(Math.max(s, 0), N - 1)] * p.scale;
    }
    if (p.removeDc) { let m = 0; for (let i = 0; i < WIN; i++) m += fr[i]; m /= WIN; for (let i = 0; i < WIN; i++) fr[i] -= m; }
    for (let i = WIN - 1; i > 0; i--) fr[i] -= 0.97 * fr[i - 1];
    fr[0] -= 0.97 * fr[0];
    re.fill(0); im.fill(0);
    for (let i = 0; i < WIN; i++) re[i] = fr[i] * win[i];
    fft(re, im, tw, rev);
    for (let m = 0; m < nMels; m++) {
      const { w, first, last } = fb[m];
      let e = 0;
      for (let k = first; k <= last; k++) e += w[k] * (re[k] * re[k] + im[k] * im[k]);
      feats[t * nMels + m] = p.logAdd ? Math.log(e + 5.960464477539063e-8) : Math.log(Math.max(e, 1.1920928955078125e-7));
    }
  }
  return { feats, frames: T, dim: nMels };
}

/** NeMo input: per-feature normalization, transposed to [nMels, T] */
export function nemoFeatures(samples, nMels = 80) {
  const { feats, frames: T } = logMel(samples, 'nemo', nMels);
  const out = new Float32Array(nMels * T);
  for (let m = 0; m < nMels; m++) {
    let mean = 0;
    for (let t = 0; t < T; t++) mean += feats[t * nMels + m];
    mean /= T;
    let v = 0;
    for (let t = 0; t < T; t++) { const d = feats[t * nMels + m] - mean; v += d * d; }
    const inv = 1 / (Math.sqrt(v / T) + 1e-5);
    for (let t = 0; t < T; t++) out[m * T + t] = (feats[t * nMels + m] - mean) * inv;
  }
  return { data: out, frames: T };
}

/** Speaker-model input: subtract the global mean, keep [T, nMels] */
export function speakerFeatures(samples, nMels = 80) {
  const { feats, frames: T } = logMel(samples, 'speaker', nMels);
  for (let m = 0; m < nMels; m++) {
    let mean = 0;
    for (let t = 0; t < T; t++) mean += feats[t * nMels + m];
    mean /= T;
    for (let t = 0; t < T; t++) feats[t * nMels + m] -= mean;
  }
  return { data: feats, frames: T };
}

/** SenseVoice input: LFR (stack 7 frames, stride 6) + CMVN, shape [T', 560] */
export function senseVoiceFeatures(samples, negMean, invStd, win = 7, shift = 6) {
  const { feats, frames: T, dim } = logMel(samples, 'sensevoice', 80);
  if (!T) return { data: new Float32Array(0), frames: 0 };
  const outT = 1 + Math.floor((T - 1) / shift), od = dim * win, left = (win - 1) >> 1;
  const out = new Float32Array(outT * od);
  for (let i = 0; i < outT; i++) {
    const c = i * shift, pad = c < left ? left - c : 0, first = c < left ? 0 : c - left, maxOff = T - 1 - first;
    for (let j = 0; j < win; j++) {
      const src = j >= pad ? (j - pad > maxOff ? T - 1 : first + j - pad) : 0;
      const o = i * od + j * dim;
      for (let k = 0; k < dim; k++) out[o + k] = (feats[src * dim + k] + negMean[j * dim + k]) * invStd[j * dim + k];
    }
  }
  return { data: out, frames: outT };
}
