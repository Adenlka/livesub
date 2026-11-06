// Speech recognition worker (Whisper via transformers.js). Shared by desktop and extension.
import { pipeline, env, AutoProcessor, AutoModel } from '@huggingface/transformers';
import { SpeakerClusterer } from './speaker.js';
import { MODEL_PRESETS } from './languages.js';
import { cleanText } from './postprocess.js';

let asr = null;
let lang = 'ja';
let finals = [];
let partial = null;
let busy = false;
let spk = null; // {processor, model, clusterer}
const SPEAKER_MODEL = 'onnx-community/wespeaker-voxceleb-resnet34-LM';

const post = (m) => self.postMessage(m);

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') init(m).catch(err => post({ type: 'status', state: 'error', message: String(err?.message ?? err) }));
  else if (m.type === 'transcribe') {
    if (m.final) {
      finals.push(m);
      if (partial && partial.id === m.id) partial = null; // A final result already exists: drop the stale partial
    } else {
      partial = m; // Keep only the latest partial request so a backlog doesn't keep increasing latency
    }
    pump();
  } else if (m.type === 'setLang') {
    lang = m.lang;
  } else if (m.type === 'setSpeakerThreshold') {
    if (spk) spk.clusterer.threshold = m.value;
  } else if (m.type === 'resetSpeakers') {
    spk?.clusterer.reset();
  }
};

async function hasWebGPU() {
  try { return !!(self.navigator?.gpu && await navigator.gpu.requestAdapter()); } catch { return false; }
}

async function load(modelId, device) {
  const preset = MODEL_PRESETS.find(p => p.id === modelId);
  const dtype = preset ? preset.dtype[device] : (device === 'webgpu' ? { encoder_model: 'fp16', decoder_model_merged: 'q4' } : 'q8');
  const files = new Map();
  post({ type: 'status', state: 'loading', message: `下载/加载模型 ${modelId}（${device}）…`, progress: 0 });
  const p = await pipeline('automatic-speech-recognition', modelId, {
    device,
    dtype,
    progress_callback: (ev) => {
      if (ev.status === 'progress' && ev.total) {
        files.set(ev.file, { loaded: ev.loaded, total: ev.total });
        let l = 0, t = 0;
        for (const f of files.values()) { l += f.loaded; t += f.total; }
        post({ type: 'status', state: 'loading', message: `下载模型 ${(l / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB`, progress: t ? l / t : 0 });
      }
    },
  });
  // Warm-up: the first inference compiles shaders, do it ahead of time
  post({ type: 'status', state: 'loading', message: '模型预热中…', progress: 1 });
  await p(new Float32Array(16000), { language: lang === 'auto' ? undefined : lang, task: 'transcribe' });
  return p;
}

async function init(m) {
  lang = m.sourceLang ?? 'ja';
  env.allowLocalModels = false;
  env.useWasmCache = false; // the extension CSP forbids blob: scripts
  env.backends.onnx.wasm.wasmPaths = {
    mjs: m.assetBase + 'ort/ort-wasm-simd-threaded.asyncify.mjs',
    wasm: m.assetBase + 'ort/ort-wasm-simd-threaded.asyncify.wasm',
  };
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

  const gpu = m.device === 'wasm' ? false : await hasWebGPU();
  const device = gpu ? 'webgpu' : 'wasm';
  let modelId = m.model === 'custom' && m.customModel ? m.customModel
    : m.model === 'auto' || !m.model ? (gpu ? MODEL_PRESETS[0].id : MODEL_PRESETS[1].id)
    : m.model;
  if (!gpu && modelId === MODEL_PRESETS[0].id) {
    post({ type: 'status', state: 'warn', message: '没有可用的 WebGPU，large-v3-turbo 在 CPU 上太慢，已改用 whisper-small' });
    modelId = MODEL_PRESETS[1].id;
  }

  try {
    asr = await load(modelId, device);
  } catch (err) {
    if (device !== 'webgpu') throw err;
    post({ type: 'status', state: 'warn', message: `WebGPU 加载失败（${err.message}），改用 CPU + whisper-small` });
    asr = await load(MODEL_PRESETS[1].id, 'wasm');
  }
  if (m.diarize) {
    try {
      post({ type: 'status', state: 'loading', message: '加载说话人识别模型…', progress: 1 });
      const processor = await AutoProcessor.from_pretrained(SPEAKER_MODEL);
      const model = await AutoModel.from_pretrained(SPEAKER_MODEL, { device: 'wasm', dtype: 'fp32' });
      spk = { processor, model, clusterer: new SpeakerClusterer({ threshold: m.speakerThreshold ?? 0.45 }) };
    } catch (err) {
      post({ type: 'status', state: 'warn', message: '说话人识别不可用：' + err.message });
    }
  }
  post({ type: 'status', state: 'ready', message: `识别就绪：${modelId.split('/').pop()}（${device}）`, model: modelId, device });
  pump();
}

async function pump() {
  if (busy || !asr) return;
  busy = true;
  try {
    while (finals.length || partial) {
      const job = finals.length ? finals.shift() : partial;
      if (job === partial) partial = null;
      const t0 = performance.now();
      let text = '';
      try {
        const out = await asr(job.audio, { language: lang === 'auto' ? undefined : lang, task: 'transcribe' });
        text = cleanText(Array.isArray(out) ? out[0]?.text : out.text, lang);
      } catch (err) {
        post({ type: 'status', state: 'warn', message: '识别出错：' + err.message });
      }
      let speaker = null;
      if (job.final && text && spk) {
        try { speaker = spk.clusterer.assign(await embed(job.audio), job.audio.length / 16000); }
        catch (err) { post({ type: 'status', state: 'warn', message: '声纹计算出错：' + err.message }); }
      }
      post({ type: 'result', id: job.id, final: !!job.final, text, speaker, ms: Math.round(performance.now() - t0), audioMs: Math.round(job.audio.length / 16) });
    }
  } finally { busy = false; }
}

async function embed(audio) {
  // The speaker model gains little from audio > 6 s: use the middle 6 s to bound the cost
  const max = 16000 * 6;
  const a = audio.length > max ? audio.subarray((audio.length - max) >> 1, ((audio.length - max) >> 1) + max) : audio;
  const inputs = await spk.processor(a);
  const out = await spk.model(inputs);
  const t = out.embeddings ?? out.last_hidden_state ?? Object.values(out)[0];
  return t.data;
}
