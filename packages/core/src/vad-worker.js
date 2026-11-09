// Segmenter worker: Silero VAD + segmenter. Separate from the recognition worker so segmentation never waits on a busy recognizer
import { t } from './i18n.js';
import * as ort from 'onnxruntime-web/webgpu';
import { SileroVad } from './engines/silero.js';
import { SpeechSegmenter } from './segmenter.js';

let seg = null, lastLevel = 0, levelPeak = 0, levelVoiced = false;
const post = (m, t) => self.postMessage(m, t);

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    ort.env.wasm.wasmPaths = { mjs: m.assetBase + 'ort/ort-wasm-simd-threaded.asyncify.mjs', wasm: m.assetBase + 'ort/ort-wasm-simd-threaded.asyncify.wasm' };
    ort.env.wasm.numThreads = 1;
    let vad = null;
    if (m.vad !== false) {
      try {
        const r = await fetch(m.assetBase + 'models/silero_vad.onnx');
        vad = await SileroVad.create({ ort, model: new Uint8Array(await r.arrayBuffer()) });
      } catch (err) {
        post({ type: 'status', state: 'warn', message: t('Voice detection model failed to load; using volume instead: ') + err.message });
      }
    }
    seg = new SpeechSegmenter({
      vad, silenceMs: m.silenceMs, maxSegmentMs: m.maxSegmentMs, partialIntervalMs: m.partialIntervalMs,
      onLevel: (rms, voiced) => {
        levelPeak = Math.max(levelPeak, rms); levelVoiced ||= voiced;
        const now = performance.now();
        if (now - lastLevel > 100) { post({ type: 'level', rms: levelPeak, voiced: levelVoiced }); lastLevel = now; levelPeak = 0; levelVoiced = false; }
      },
      onPartial: (p) => post({ type: 'partial', ...p }, [p.audio.buffer]),
      onFinal: (f) => post({ type: 'final', ...f }, f.audio ? [f.audio.buffer, f.scores.buffer] : []),
    });
    if (m.nextId) seg.nextId = m.nextId;
    post({ type: 'vad-ready', vad: !!vad });
  } else if (m.type === 'audio') {
    seg?.push(m.samples);
  } else if (m.type === 'params') {
    if (seg) { seg.silenceMs = m.silenceMs ?? seg.silenceMs; seg.maxSegmentMs = m.maxSegmentMs ?? seg.maxSegmentMs; }
  } else if (m.type === 'reset') {
    // file transcription: timeline starts at 0
    if (seg) { await seg.flush(); seg.totalFrames = 0; seg.carry = new Float32Array(0); seg.preRoll = []; seg.vad?.reset?.(); }
    post({ type: 'flushed' });
  } else if (m.type === 'flush') {
    await seg?.flush();
    post({ type: 'flushed', nextId: seg?.nextId, totalMs: seg ? seg.totalFrames * seg.frameMs : 0 });
  }
};
