// Online speaker clustering: one voiceprint per segment -> assign to an existing speaker or create a new one
import { t, uiLang } from './i18n.js';
// Limitation: overlapping speech within one segment goes to a single speaker
export const SPEAKER_COLORS = ['#ffe066', '#7ad7ff', '#ff9db5', '#9dffa1', '#ffb86b', '#c9a6ff', '#6bffe1', '#ff7a7a'];

export function normalize(v) {
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const k = 1 / (Math.sqrt(s) || 1);
  return Float32Array.from(v, x => x * k);
}
export function cos(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

export class SpeakerClusterer {
  constructor({ threshold = 0.5, maxSpeakers = 8, minNewSec = 1.0 } = {}) {
    this.threshold = threshold;   // cosine similarity >= this counts as the same person
    this.maxSpeakers = maxSpeakers;
    this.minNewSec = minNewSec;   // voiceprints of very short clips are unreliable and never create a new speaker
    this.speakers = [];           // {centroid, n}
    this.last = null;
  }

  /** @returns {number|null} speaker index (from 0), null when undecidable */
  assign(embedding, durationSec) {
    const e = normalize(embedding);
    let best = -1, bestSim = -2;
    this.speakers.forEach((s, i) => { const c = cos(e, s.centroid); if (c > bestSim) { bestSim = c; best = i; } });

    const reliable = durationSec >= this.minNewSec;
    if (best >= 0 && bestSim >= this.threshold) {
      if (reliable) this._update(best, e);
      return (this.last = best);
    }
    if (!reliable) {
      // short utterance: loosely assign to the closest speaker, otherwise keep the previous one
      if (best >= 0 && bestSim >= this.threshold - 0.15) return (this.last = best);
      return this.last;
    }
    if (this.speakers.length < this.maxSpeakers) {
      this.speakers.push({ centroid: e, n: 1 });
      return (this.last = this.speakers.length - 1);
    }
    this._update(best, e);
    return (this.last = best);
  }

  _update(i, e) {
    const s = this.speakers[i];
    const w = Math.min(s.n, 20); // cap the weight so a voiceprint can drift slowly
    const c = Float32Array.from(s.centroid, (x, k) => x * w + e[k]);
    s.centroid = normalize(c);
    s.n++;
  }

  reset() { this.speakers = []; this.last = null; }
}

export const speakerName = (i) => i == null ? '' : t('说话人') + (['en', 'ko'].includes(uiLang()) ? ' ' : '') + String.fromCharCode(65 + (i % 26));
