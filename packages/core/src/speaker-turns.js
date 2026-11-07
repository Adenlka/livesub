// Speaker-change detection inside a segment: try cutting at short pauses and split when the voiceprints on both sides differ
// Fixes meetings where turn gaps are very short (<0.6 s) and two people end up in one segment
import { normalize, cos } from './speaker.js';

const FRAME = 512;

/**
 * @param {Float32Array} audio
 * @param {ArrayLike<number>} scores VAD score per 512-sample frame
 * @param {(a:Float32Array)=>Promise<Float32Array>} embed
 * @returns {Promise<{start:number,end:number,emb:Float32Array}[]>} sub-segments (sample indices) with their voiceprints
 */
export async function splitSpeakerTurns(audio, scores, embed, { threshold = 0.4, minSec = 1.5, maxCandidates = 2, windowSec = 2.5 } = {}) {
  const N = audio.length, minLen = minSec * 16000;
  const whole = async () => [{ start: 0, end: N, emb: normalize(await embed(audio)) }];
  if (!scores || N < minLen * 2) return whole();

  // candidate cuts: pauses of >= 3 low-score frames (~96 ms), at the pause midpoint; keep the longest few
  const cands = [];
  for (let i = 0; i < scores.length;) {
    if (scores[i] < 0.5) {
      let j = i; while (j < scores.length && scores[j] < 0.5) j++;
      if (j - i >= 3) cands.push({ at: Math.round((i + j) / 2) * FRAME, len: j - i });
      i = j;
    } else i++;
  }
  const picked = cands.filter(c => c.at >= minLen && N - c.at >= minLen)
    .sort((a, b) => b.len - a.len).slice(0, maxCandidates).sort((a, b) => a.at - b.at);
  if (!picked.length) return whole();

  const parts = [];
  let s = 0, embS = null;
  for (const c of picked) {
    if (c.at - s < minLen) continue;
    // embed only windowSec seconds on each side of the cut (enough to detect a change, cheap)
    embS ??= normalize(await embed(audio.subarray(Math.max(s, c.at - windowSec * 16000), c.at)));
    const next = picked.find(p => p.at > c.at + minLen)?.at ?? N;
    const right = normalize(await embed(audio.subarray(c.at, Math.min(next, c.at + windowSec * 16000))));
    if (cos(embS, right) < threshold) {
      parts.push({ start: s, end: c.at, emb: null }); // sub-segment voiceprints are recomputed on the full sub-segment later for better clustering
      s = c.at; embS = right;
    } else embS = null; // no change: take the left window again at the next cut
  }
  if (!parts.length) return whole(); // no change: use the whole-segment voiceprint (more reliable than half)
  parts.push({ start: s, end: N, emb: null });
  return parts;
}
