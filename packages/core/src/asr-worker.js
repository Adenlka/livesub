// Recognition worker: Parakeet (ja/en) / Zipformer (zh/ko) / SenseVoice (per-sentence language ID + punctuation) / Whisper (other languages) + speaker embeddings + hotwords
import * as ort from 'onnxruntime-web/webgpu';
import { MODELS, WHISPER_MODELS, REFINE_MODEL, resolveEngine } from './config.js';
import { getModelFile } from './model-store.js';
import { ParakeetCtc } from './engines/parakeet.js';
import { SenseVoice } from './engines/sensevoice.js';
import { ParakeetTdt } from './engines/parakeet-tdt.js';
import { ZipformerCtc } from './engines/zipformer.js';
import { transferPunct } from './merge-punct.js';
import { enItn } from './en-itn.js';
import { SpeakerEmbedder } from './engines/speaker-embed.js';
import { SpeakerClusterer, normalize } from './speaker.js';
import { splitSpeakerTurns } from './speaker-turns.js';
import { cleanText, parsePairs, titleTerms } from './postprocess.js';

let engine = null;     // { name, label, transcribe(audio) → {text, conf, lang}, setHotwords? }
let spk = null;        // { embedder, clusterer }
let cfg = {};
let finals = [], partial = null, busy = false;
let partialCooldownUntil = 0; // adaptive cooldown for partial results: refresh less often when CPU is tight so finals never fall behind
const post = (m, t) => self.postMessage(m, t);
const status = (state, message, extra = {}) => post({ type: 'status', state, message, ...extra });

self.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init': init(m).catch(err => status('error', friendlyError(err))); break;
    case 'transcribe':
      if (m.final) { finals.push(m); if (partial?.id === m.id) partial = null; }
      else partial = m; // keep only the latest partial request to avoid a backlog
      pump();
      break;
    case 'config':
      Object.assign(cfg, m.config);
      cfg.corrections = parsePairs(cfg.correctionsText);
      if ('glossaryText' in m.config || 'pageTitle' in m.config || 'topic' in m.config) engine?.setHotwords?.(hotwords(cfg.glossaryText));
      if (spk && m.config.speakerThreshold != null) spk.clusterer.threshold = m.config.speakerThreshold;
      break;
    case 'resetSpeakers': spk?.clusterer.reset(); break;
  }
};

function friendlyError(err) {
  const msg = String(err?.message ?? err);
  if (/Failed to fetch|NetworkError|下载失败/.test(msg)) return '模型下载失败，请检查网络；也可以在设置里把「模型下载源」换成镜像。' + (msg.includes('下载失败') ? `（${msg}）` : '');
  if (/memory|Out of memory|RangeError/i.test(msg)) return '内存不足，模型加载失败。请关闭其他占内存的程序，或换用更小的模型。';
  return msg;
}

/** The glossary's source terms double as recognition hotwords */
function hotwords(text) {
  const g = parsePairs(text).map(([a]) => a).filter(a => a.length >= 2);
  // Proper nouns in the page / stream title also become hotwords (the extension passes the tab title automatically)
  const topic = (cfg.topic ?? '').split(/[\s,，、/|｜]+/).filter(w => w.length >= 2 && w.length <= 20);
  for (const w of [...topic, ...titleTerms(cfg.pageTitle)]) if (!g.includes(w)) g.push(w);
  return g;
}

function setupOrt(m) {
  ort.env.wasm.wasmPaths = { mjs: m.assetBase + 'ort/ort-wasm-simd-threaded.asyncify.mjs', wasm: m.assetBase + 'ort/ort-wasm-simd-threaded.asyncify.wasm' };
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
}

async function init(m) {
  cfg = { ...m, corrections: parsePairs(m.correctionsText) };
  setupOrt(m);
  const progress = (label) => (loaded, total) =>
    status('loading', `下载${label} ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`, { progress: total ? loaded / total : 0 });
  const opts = (label) => ({ host: m.modelHost, localBase: m.localModelBase, onProgress: progress(label) });

  const { primary, refine } = resolveEngine(m.engine, m.sourceLang);
  const text = (b) => new TextDecoder().decode(b);
  const files = (id, label) => Promise.all(MODELS[id].files.map((f, i) =>
    getModelFile(id, f, f.endsWith('.txt') ? { ...opts('词表'), onProgress: null } : opts(label + (MODELS[id].files.length > 2 ? `（${i + 1}）` : '')))));
  // Loader per model; sentences that arrive early wait in the queue until everything is loaded
  const LOAD = {
    'parakeet-ja': async () => {
      status('loading', '准备日语识别模型…', { progress: 0 });
      const [model, tokens] = await files('parakeet-ja', '日语识别模型');
      status('loading', '加载日语识别模型…', { progress: 1 });
      const p = await ParakeetCtc.create({ ort, model, tokens: text(tokens) });
      return { transcribe: (a) => p.transcribe(a), setHotwords: (w) => p.setHotwords(w, 2.5), release: () => Promise.all([p.session, p.enc, p.dec, p.join].filter(Boolean).map(x => x.release?.())), };
    },
    'parakeet-en': async () => {
      status('loading', '准备英语识别模型…', { progress: 0 });
      const [encoder, decoder, joiner, tokens] = await files('parakeet-en', '英语识别模型');
      status('loading', '加载英语识别模型…', { progress: 1 });
      const p = await ParakeetTdt.create({ ort, encoder, decoder, joiner, tokens: text(tokens) });
      return { transcribe: async (a) => { const r = await p.transcribe(a); return { ...r, text: enItn(r.text) }; }, setHotwords: () => {}, release: () => Promise.all([p.session, p.enc, p.dec, p.join].filter(Boolean).map(x => x.release?.())), };
    },
    'zipformer-zh': async () => {
      status('loading', '准备中文识别模型…', { progress: 0 });
      const [model, tokens] = await files('zipformer-zh', '中文识别模型');
      status('loading', '加载中文识别模型…', { progress: 1 });
      const z = await ZipformerCtc.create({ ort, model, tokens: text(tokens) });
      return { transcribe: (a) => z.transcribe(a), setHotwords: (w) => z.setHotwords(w, 2.5), release: () => z.session.release?.() };
    },
    'sensevoice': async () => {
      status('loading', '准备中英日识别模型…', { progress: 0 });
      const [[model, tokens], cmvn] = await Promise.all([files('sensevoice', '中英日识别模型'), fetch(m.assetBase + 'models/sensevoice-cmvn.json').then(r => r.json())]);
      status('loading', '加载中英日识别模型…', { progress: 1 });
      const sv = await SenseVoice.create({ ort, model, tokens: text(tokens), cmvn });
      return { transcribe: (a, lang) => sv.transcribe(a, lang), setHotwords: (w) => sv.setHotwords(w) };
    },
  };
  const NAMES = { 'parakeet-ja': 'Parakeet 日语', 'parakeet-en': 'Parakeet 英语', 'zipformer-zh': 'Zipformer 中文', sensevoice: 'SenseVoice' };
  let eng = null;
  if (primary === 'parakeet-ja' || primary === 'parakeet-en') {
    const p = await LOAD[primary]();
    const lang = primary === 'parakeet-ja' ? 'ja' : 'en';
    eng = { name: primary, label: NAMES[primary], transcribe: async (a) => ({ ...(await p.transcribe(a)), lang }), setHotwords: p.setHotwords };
  } else if (primary === 'sensevoice') {
    const sv = await LOAD.sensevoice();
    // Refine models: in single-language mode (Chinese) loaded before starting; in multi-language mode switched on demand (see below)
    const fine = {};      // lang -> loaded model
    let hw = [];
    const loadFine = async (l) => {
      try { const x = await LOAD[REFINE_MODEL[l]](); x.setHotwords(hw); fine[l] = x; return x; }
      catch (err) { status('warn', `${NAMES[REFINE_MODEL[l]]}加载失败，${l === 'zh' ? '中文' : l === 'ja' ? '日语' : '英语'}改用 SenseVoice：` + friendlyError(err)); return null; }
    };
    // Multi-language mode: to save memory, keep only one refine model at a time (about 0.6-1 GB each).
    // Switch to a language's refine model after it appears in 2 sentences in a row (loaded in the background; SenseVoice is used until it is ready)
    const multi = refine.length > 1;
    let active = null, switching = null, streak = { lang: null, n: 0 };
    const switchTo = (l) => switching ??= (async () => {
      if (active && fine[active]) { const old = fine[active]; delete fine[active]; try { await old.release?.(); } catch {} }
      active = null;
      if (await loadFine(l)) { active = l; status('ready', `识别就绪：${eng.label}`, { engine: eng.name, threads: ort.env.wasm.numThreads, speakers: !!spk }); }
    })().finally(() => { switching = null; });
    if (!multi) for (const l of refine) await loadFine(l);
    eng = {
      name: primary,
      get label() { return ['SenseVoice', ...Object.keys(fine).map(l => NAMES[REFINE_MODEL[l]])].join(' + '); },
      async transcribe(a, { partial = false } = {}) {
        const r = await sv.transcribe(a, cfg.sourceLang === 'auto' ? 'auto' : cfg.sourceLang);
        const lang = r.lang ?? (cfg.sourceLang === 'auto' ? null : cfg.sourceLang);
        const f = fine[lang];
        if (multi && !partial && r.text && lang && REFINE_MODEL[lang] && !f) {
          streak = streak.lang === lang ? { lang, n: streak.n + 1 } : { lang, n: 1 };
          if (streak.n >= 2 && !switching) switchTo(lang);
        } else if (f) streak = { lang, n: 0 };
        // Partials use SenseVoice only (fast); finals go to that language's refine model
        if (partial || !f || !r.text) return { ...r, lang };
        const x = await f.transcribe(a);
        // Chinese: Zipformer has more accurate characters but no punctuation; take punctuation and digits from SenseVoice
        if (lang === 'zh') return { text: transferPunct(x.text, r.text), conf: x.conf, lang };
        return { ...x, lang };
      },
      setHotwords: (w) => { hw = w; sv.setHotwords(w); for (const f of Object.values(fine)) f.setHotwords(w); },
    };
  } else {
    eng = await loadWhisper(primary, m, progress('Whisper 模型'));
  }
  eng.setHotwords?.(hotwords(m.glossaryText));
  await eng.transcribe(new Float32Array(16000)); // warm-up

  if (m.diarize) {
    try {
      status('loading', '加载说话人识别…', { progress: 1 });
      const model = await getModelFile('campplus', MODELS.campplus.files[0], opts('声纹模型'));
      const embedder = await SpeakerEmbedder.create({ ort, model });
      spk = { embedder, clusterer: new SpeakerClusterer({ threshold: m.speakerThreshold ?? 0.5 }) };
    } catch (err) {
      status('warn', '说话人识别不可用：' + friendlyError(err));
    }
  }
  engine = eng;
  status('ready', `识别就绪：${engine.label ?? engine.name}`, { engine: engine.name, threads: ort.env.wasm.numThreads, speakers: !!spk });
  pump();
}

async function loadWhisper(name, m, onProgress) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  env.useWasmCache = false; // the extension CSP forbids blob: scripts
  env.backends.onnx.wasm.wasmPaths = ort.env.wasm.wasmPaths;
  env.backends.onnx.wasm.numThreads = ort.env.wasm.numThreads;
  if (m.modelHost === 'mirror') env.remoteHost = 'https://hf-mirror.com/';
  else if (m.modelHost && m.modelHost !== 'hf') env.remoteHost = m.modelHost.replace(/\/?$/, '/');
  let gpu = false;
  if (m.device !== 'wasm') { try { gpu = !!(self.navigator?.gpu && await navigator.gpu.requestAdapter()); } catch {} }
  let key = m.engine === 'custom' ? null : name;
  if (key === 'whisper-turbo' && !gpu) { status('warn', '没有可用的显卡（WebGPU），turbo 在 CPU 上太慢，已改用 whisper-small'); key = 'whisper-small'; }
  const spec = key ? WHISPER_MODELS[key] : { id: m.customModel, dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: 'q8' } };
  const files = new Map();
  const load = async (device) => {
    const p = await pipeline('automatic-speech-recognition', spec.id, {
      device, dtype: spec.dtype[device],
      progress_callback: (ev) => {
        if (ev.status === 'progress' && ev.total) {
          files.set(ev.file, ev); let l = 0, t = 0;
          for (const f of files.values()) { l += f.loaded; t += f.total; }
          onProgress(l, t);
        }
      },
    });
    const lang = m.sourceLang === 'auto' ? undefined : m.sourceLang;
    const run = async (audio) => {
      const out = await p(audio, { language: cfg.sourceLang === 'auto' ? undefined : cfg.sourceLang ?? lang, task: 'transcribe' });
      return { text: Array.isArray(out) ? out[0]?.text : out.text, conf: 1, lang: cfg.sourceLang === 'auto' ? null : cfg.sourceLang };
    };
    await run(new Float32Array(16000));
    return { name: key ?? 'whisper-custom', label: spec.id.split('/').pop() + `（${device === 'webgpu' ? '显卡' : 'CPU'}）`, transcribe: run };
  };
  try { return await load(gpu ? 'webgpu' : 'wasm'); }
  catch (err) {
    if (!gpu) throw err;
    status('warn', `显卡加载失败（${err.message}），改用 CPU`);
    return load('wasm');
  }
}

async function pump() {
  if (busy || !engine) return;
  busy = true;
  try {
    while (finals.length || partial) {
      const job = finals.length ? finals.shift() : partial;
      if (job === partial) {
        partial = null;
        // Cooling down / segment too long: skip this partial (the final will be fully recognized)
        if (performance.now() < partialCooldownUntil) continue;
      }
      const t0 = performance.now();
      try {
        if (!job.final) {
          // For long segments the partial only decodes the last 5 seconds: bounded cost, never slows finals
          const long = job.audio.length > 16000 * 6;
          const r = await engine.transcribe(long ? job.audio.subarray(job.audio.length - 16000 * 5) : job.audio, { partial: true });
          if (long) r.text = '…' + r.text;
          const text = cleanText(r.text, { lang: r.lang ?? cfg.sourceLang, engine: engine.name, conf: 1, corrections: cfg.corrections });
          post({ type: 'partial', id: job.id, text, lang: r.lang ?? null });
          const took = performance.now() - t0;
          // Partials use at most ~40% of the time: if one takes X, skip partials for the next 1.5X
          partialCooldownUntil = performance.now() + took * 1.5;
          continue;
        }
        // Final: optional speaker-turn split -> recognize each part -> speaker clustering
        let parts = [{ start: 0, end: job.audio.length, emb: null }];
        if (spk && cfg.splitTurns) {
          parts = await splitSpeakerTurns(job.audio, job.scores, (a) => spk.embedder.embed(a), { threshold: Math.min(0.4, spk.clusterer.threshold) });
        }
        const out = [];
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          const audio = job.audio.subarray(p.start, p.end);
          const r = await engine.transcribe(audio);
          const text = cleanText(r.text, { lang: r.lang ?? cfg.sourceLang, engine: engine.name, conf: r.conf, corrections: cfg.corrections });
          let speaker = null;
          if (spk && text) {
            const emb = p.emb ?? normalize(await spk.embedder.embed(audio));
            speaker = spk.clusterer.assign(emb, audio.length / 16000);
          }
          out.push({ sub: i, text, conf: r.conf, speaker, startMs: job.startMs + p.start / 16, endMs: job.startMs + p.end / 16, dur: +(audio.length / 16000).toFixed(2), parts: parts.length, lang: r.lang ?? null });
        }
        post({ type: 'final', id: job.id, cut: !!job.cut, parts: out, ms: Math.round(performance.now() - t0), audioMs: Math.round(job.audio.length / 16) });
      } catch (err) {
        status('warn', '识别出错：' + err.message);
        if (job.final) post({ type: 'final', id: job.id, parts: [] });
      }
    }
  } finally { busy = false; }
}
