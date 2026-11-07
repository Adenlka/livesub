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
import { t } from './i18n.js';

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
    // Messages handled by the refine child worker
    case 'switch': refiner?.switchTo(m.lang); break;
    case 'refine': refiner?.run(m); break;
    case 'drop': refiner?.drop(m.jid); break;
    case 'hotwords': refiner?.hotwords(m.words); break;
  }
};

function friendlyError(err) {
  const msg = String(err?.message ?? err);
  if (/Failed to fetch|NetworkError|下载失败|download failed|ダウンロード失敗/i.test(msg)) return t('模型下载失败，请检查网络；也可以在设置里把「模型下载源」换成镜像。') + (/Failed to fetch|NetworkError/.test(msg) ? '' : ` (${msg})`);
  if (/memory|Out of memory|RangeError/i.test(msg)) return t('内存不足，模型加载失败。请关闭其他占内存的程序，或换用更小的模型。');
  return msg;
}

/**
 * Was this sentence possibly misheard? Each model has its own confidence scale; thresholds were tuned on real conversational speech:
 * about 70% of sentences below the threshold really do contain more errors
 */
const UNSURE_BELOW = { 'parakeet-ja': 0.88, 'zipformer-zh': 0.8, 'parakeet-en': 0.88, sensevoice: 0.85 };
function isUnsure(r, text) {
  const th = UNSURE_BELOW[r.model];
  if (!th || r.conf == null || !text) return false;
  return [...text.replace(/[\s\p{P}\p{S}]/gu, '')].length >= 3 && r.conf < th;
}

const EN_FILLER = /^(?:ok(?:ay)?|o\.k\.|yeah|yes|yep|yup|no|oh|ah|uh|um|hmm+|mm+|wow|bye|hi|hey|thank you|thanks|you|so|well|right|i|the|and)(?:[\s,.!?]+(?:ok(?:ay)?|yeah|yes|oh|thank you|bye))*[\s,.!?]*$/i;
const recentLangs = [];
/** Language that dominates the recent sentences; null when there is no clear majority */
function dominantLang() {
  if (recentLangs.length < 3) return null;
  const n = {}; for (const l of recentLangs) n[l] = (n[l] ?? 0) + 1;
  const [l, c] = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return c > recentLangs.length / 2 ? l : null;
}

function toInt16(a) { const o = new Int16Array(a.length); for (let i = 0; i < a.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(a[i] * 32767))); return o; }

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
  const hc = navigator.hardwareConcurrency || 2;
  // Thread budget: with a refine worker, SenseVoice gets 2 threads and the refine model 4 (they run in parallel)
  const want = m.role === 'refine' ? Math.min(4, hc - 2) : m.splitThreads ? Math.min(2, hc - 1) : Math.min(4, hc - 1);
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, want) : 1;
}

const modelName = (id) => ({ 'parakeet-ja': t('Parakeet 日语'), 'parakeet-en': t('Parakeet 英语'), 'zipformer-zh': t('Zipformer 中文'), sensevoice: 'SenseVoice' })[id] ?? id;
const langName = (l) => t(l === 'zh' ? '中文' : l === 'ja' ? '日语' : '英语');

// --- parent worker side: handle to the refine child worker ---
function spawnRefiner(m, langs) {
  const w = new Worker(self.location.href, { type: 'module' });
  const loaded = new Set(), pending = new Map();
  let wanted = null, seq = 0, readyResolve;
  const ready = new Promise(r => { readyResolve = r; });
  const failAll = () => { for (const res of pending.values()) res(null); pending.clear(); };
  w.onmessage = (e) => {
    const x = e.data;
    if (x.type === 'status') return post(x); // download progress, on-demand download notices, etc. are forwarded to the main thread as-is
    if (x.type === 'loaded') {
      loaded.clear(); x.langs.forEach(l => loaded.add(l));
      if (x.langs.length) { readyResolve(); if (engine) status('ready', t('识别就绪：') + engine.label, { engine: engine.name, threads: ort.env.wasm.numThreads, speakers: !!spk }); }
      return;
    }
    if (x.type === 'failed') { if (wanted === x.lang) wanted = null; readyResolve(); return; }
    if (x.type === 'refined') { const res = pending.get(x.jid); pending.delete(x.jid); res?.(x); }
  };
  w.onerror = (e) => { status('warn', t('识别出错：') + (e.message ?? 'refine worker')); readyResolve(); failAll(); };
  w.postMessage({ ...m, type: 'init', role: 'refine', langs });
  return {
    loaded, ready,
    want(l) { if (wanted === l || loaded.has(l)) return; wanted = l; w.postMessage({ type: 'switch', lang: l }); },
    run(a, lang, jid = 'r' + (++seq)) {
      return new Promise(res => { pending.set(jid, res); const c = a.slice(); w.postMessage({ type: 'refine', jid, lang, audio: c }, [c.buffer]); });
    },
    drop: (jid) => w.postMessage({ type: 'drop', jid }),
    hotwords: (words) => w.postMessage({ type: 'hotwords', words }),
  };
}

// --- child worker side: only loads/switches refine models and refines jobs in order ---
let refiner = null;
async function initRefiner(m) {
  const { LOAD } = makeLoaders(m);
  const fine = {}, failedAt = {}, asked = {};
  const multi = m.langs.length > 1;
  let hw = [], chain = Promise.resolve();
  const announce = () => post({ type: 'loaded', langs: Object.keys(fine) });
  const loadFine = async (l) => {
    try { const x = await LOAD[REFINE_MODEL[l]](); x.setHotwords(hw); fine[l] = x; return x; }
    catch (err) {
      failedAt[l] = Date.now();
      // Desktop: refine models are downloaded on demand. The first time a language is heard, ask the main process to download it in the background; SenseVoice is used until then
      if (m.localModelBase && multi && !asked[l]) { asked[l] = true; status('loading', t('听到{l}，后台下载{l}精识别模型（只需一次，期间照常出字幕）', { l: langName(l) }), { needModel: REFINE_MODEL[l] }); }
      else if (!asked[l]) { asked[l] = true; status('warn', t('{m}加载失败，{l}改用 SenseVoice：', { m: modelName(REFINE_MODEL[l]), l: langName(l) }) + friendlyError(err)); }
      post({ type: 'failed', lang: l });
      return null;
    }
  };
  const switchTo = (l) => { chain = chain.then(async () => {
    if (fine[l]) return announce();
    if (Date.now() - (failedAt[l] ?? 0) < 20000) return post({ type: 'failed', lang: l });
    // Multi-language mode keeps only one refine model loaded at a time to save memory (each is ~0.6-1GB)
    if (multi) for (const k of Object.keys(fine)) { const old = fine[k]; delete fine[k]; announce(); try { await old.release?.(); } catch {} }
    if (await loadFine(l)) announce();
  }); };
  const q = [], dropped = new Set();
  let busyR = false;
  const pumpR = async () => {
    if (busyR) return; busyR = true;
    while (q.length) {
      const j = q.shift();
      const f = fine[j.lang];
      if (dropped.delete(j.jid) || !f) { post({ type: 'refined', jid: j.jid, text: null }); continue; }
      try { const x = await f.transcribe(j.audio); post({ type: 'refined', jid: j.jid, text: x.text, conf: x.conf }); }
      catch (err) { post({ type: 'refined', jid: j.jid, text: null }); }
    }
    busyR = false;
  };
  refiner = {
    switchTo,
    run(j) { q.push(j); pumpR(); },
    drop(jid) { dropped.add(jid); },
    hotwords(w) { hw = w; for (const f of Object.values(fine)) f.setHotwords(w); },
  };
  if (!multi) switchTo(m.langs[0]);
}

function makeLoaders(m) {
  const progress = (label) => (loaded, total) =>
    status('loading', t('下载{label} {a} / {b} MB', { label: t(label), a: (loaded / 1e6).toFixed(0), b: (total / 1e6).toFixed(0) }), { progress: total ? loaded / total : 0 });
  const opts = (label) => ({ host: m.modelHost, localBase: m.localModelBase, onProgress: progress(label) });

  const text = (b) => new TextDecoder().decode(b);
  const files = (id, label) => Promise.all(MODELS[id].files.map((f, i) =>
    getModelFile(id, f, f.endsWith('.txt') ? { ...opts('词表'), onProgress: null } : opts(t(label) + (MODELS[id].files.length > 2 ? ` (${i + 1})` : '')))));
  // Loader per model; sentences that arrive early wait in the queue until everything is loaded
  const LOAD = {
    'parakeet-ja': async () => {
      status('loading', t('准备日语识别模型…'), { progress: 0 });
      const [model, tokens] = await files('parakeet-ja', '日语识别模型');
      status('loading', t('加载日语识别模型…'), { progress: 1 });
      const p = await ParakeetCtc.create({ ort, model, tokens: text(tokens) });
      return { transcribe: (a) => p.transcribe(a), setHotwords: (w) => p.setHotwords(w, 2.5), release: () => Promise.all([p.session, p.enc, p.dec, p.join].filter(Boolean).map(x => x.release?.())), };
    },
    'parakeet-en': async () => {
      status('loading', t('准备英语识别模型…'), { progress: 0 });
      const [encoder, decoder, joiner, tokens] = await files('parakeet-en', '英语识别模型');
      status('loading', t('加载英语识别模型…'), { progress: 1 });
      const p = await ParakeetTdt.create({ ort, encoder, decoder, joiner, tokens: text(tokens) });
      return { transcribe: async (a) => { const r = await p.transcribe(a); return { ...r, text: enItn(r.text) }; }, setHotwords: () => {}, release: () => Promise.all([p.session, p.enc, p.dec, p.join].filter(Boolean).map(x => x.release?.())), };
    },
    'zipformer-zh': async () => {
      status('loading', t('准备中文识别模型…'), { progress: 0 });
      const [model, tokens] = await files('zipformer-zh', '中文识别模型');
      status('loading', t('加载中文识别模型…'), { progress: 1 });
      const z = await ZipformerCtc.create({ ort, model, tokens: text(tokens) });
      return { transcribe: (a) => z.transcribe(a), setHotwords: (w) => z.setHotwords(w, 2.5), release: () => z.session.release?.() };
    },
    'sensevoice': async () => {
      status('loading', t('准备中英日识别模型…'), { progress: 0 });
      const [[model, tokens], cmvn] = await Promise.all([files('sensevoice', '中英日识别模型'), fetch(m.assetBase + 'models/sensevoice-cmvn.json').then(r => r.json())]);
      status('loading', t('加载中英日识别模型…'), { progress: 1 });
      const sv = await SenseVoice.create({ ort, model, tokens: text(tokens), cmvn });
      return { transcribe: (a, lang) => sv.transcribe(a, lang), setHotwords: (w) => sv.setHotwords(w) };
    },
  };
  return { LOAD, progress, opts };
}

async function init(m) {
  cfg = { ...m, corrections: parsePairs(m.correctionsText) };
  if (m.role !== 'refine') { const e = resolveEngine(m.engine, m.sourceLang); m.splitThreads = e.primary === 'sensevoice' && e.refine.length > 0; }
  setupOrt(m);
  if (m.role === 'refine') return initRefiner(m);
  const { LOAD, progress, opts } = makeLoaders(m);
  const { primary, refine } = resolveEngine(m.engine, m.sourceLang);
  const NAMES = new Proxy({}, { get: (_, k) => modelName(k) });
  let eng = null;
  if (primary === 'parakeet-ja' || primary === 'parakeet-en') {
    const p = await LOAD[primary]();
    const lang = primary === 'parakeet-ja' ? 'ja' : 'en';
    eng = { name: primary, label: NAMES[primary], transcribe: async (a) => ({ ...(await p.transcribe(a)), lang, model: primary }), setHotwords: p.setHotwords };
  } else if (primary === 'sensevoice') {
    const sv = await LOAD.sensevoice();
    // The refine model runs in a separate worker in parallel, so SenseVoice's first pass is never blocked by the previous sentence being refined
    const ref = refine.length ? spawnRefiner(m, refine) : null;
    const multi = refine.length > 1;
    let streak = { lang: null, n: 0 };
    eng = {
      name: primary,
      get label() { return ['SenseVoice', ...(ref ? [...ref.loaded].map(l => NAMES[REFINE_MODEL[l]]) : [])].join(' + '); },
      // Pass 1: SenseVoice (fast) -> subtitle right away
      async fast(a, { partial = false } = {}) {
        let r = await sv.transcribe(a, cfg.sourceLang === 'auto' ? 'auto' : cfg.sourceLang);
        // Auto language: LID is very unreliable on short utterances (interjections, 'なんだ？', 'ぎゃー'), often returning en/yue/ko.
        // When one language has dominated recently, short utterances and off-language results are decoded again in that language
        const dom = dominantLang();
        if (cfg.sourceLang === 'auto' && dom && r.lang !== dom && (a.length < 16000 * 2.5 || !['ja', 'zh', 'en'].includes(r.lang))) {
          const forced = await sv.transcribe(a, dom);
          if (forced.text) r = { ...forced, lang: dom };
        }
        const lang = r.lang ?? (cfg.sourceLang === 'auto' ? null : cfg.sourceLang);
        if (ref && multi && !partial && r.text && lang && REFINE_MODEL[lang] && !ref.loaded.has(lang)) {
          streak = streak.lang === lang ? { lang, n: streak.n + 1 } : { lang, n: 1 };
          // Switch to a language's refine model after 2 consecutive sentences in it (only one is kept to save memory)
          if (streak.n >= 2) ref.want(lang);
        } else if (ref?.loaded.has(lang)) streak = { lang, n: 0 };
        return { ...r, lang, model: 'sensevoice' };
      },
      canRefine: (r) => !!(ref && r.text && ref.loaded.has(r.lang)),
      // Pass 2: the language's refine model (in the other worker)
      async refine(a, r, jid) {
        const x = await ref.run(a, r.lang, jid);
        if (!x || x.text == null) return r;
        // Chinese: Zipformer has more accurate characters but no punctuation; take punctuation and digits from SenseVoice
        if (r.lang === 'zh') return { text: transferPunct(x.text, r.text), conf: x.conf, lang: r.lang, model: REFINE_MODEL.zh };
        return { ...x, lang: r.lang, model: REFINE_MODEL[r.lang] };
      },
      async transcribe(a, { partial = false } = {}) {
        const r = await this.fast(a, { partial });
        if (partial || !this.canRefine(r)) return r;
        return this.refine(a, r);
      },
      setHotwords: (w) => { sv.setHotwords(w); ref?.hotwords(w); },
      ref,
    };
    // Single language: wait for the refine model before starting (file transcription needs it); live mode shows SenseVoice text until it is ready
    if (ref && !multi && !cfg.twoPass) await ref.ready;
  } else {
    eng = await loadWhisper(primary, m, progress('Whisper 模型'));
  }
  eng.setHotwords?.(hotwords(m.glossaryText));
  await eng.transcribe(new Float32Array(16000)); // warm-up

  if (m.diarize) {
    try {
      status('loading', t('加载说话人识别…'), { progress: 1 });
      const model = await getModelFile('campplus', MODELS.campplus.files[0], opts('声纹模型'));
      const embedder = await SpeakerEmbedder.create({ ort, model });
      spk = { embedder, clusterer: new SpeakerClusterer({ threshold: m.speakerThreshold ?? 0.5 }) };
    } catch (err) {
      status('warn', t('说话人识别不可用：') + friendlyError(err));
    }
  }
  engine = eng;
  status('ready', t('识别就绪：') + (engine.label ?? engine.name), { engine: engine.name, threads: ort.env.wasm.numThreads, speakers: !!spk });
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
  if (key === 'whisper-turbo' && !gpu) { status('warn', t('没有可用的显卡（WebGPU），turbo 在 CPU 上太慢，已改用 whisper-small')); key = 'whisper-small'; }
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
    status('warn', t('显卡加载失败（{e}），改用 CPU', { e: err.message }));
    return load('wasm');
  }
}

let inflight = []; // finals already shown from pass 1, waiting for their refined text (in time order)
let refineSeq = 0;

/** Post-process a final segment's text (drops isolated English filler hallucinations) */
function finishText(r) {
  let text = cleanText(r.text, { lang: r.lang ?? cfg.sourceLang, engine: engine.name, conf: r.conf, corrections: cfg.corrections });
  // In Japanese/Chinese content, noise, laughter and BGM are often recognized as a lone 'OK', 'Yeah' or 'Thank you'
  if (text && EN_FILLER.test(text) && jaZhContext()) text = '';
  return text;
}
const jaZhContext = () => ['ja', 'zh'].includes(cfg.sourceLang) || (cfg.sourceLang === 'auto' && recentLangs.filter(l => l !== 'en').length > recentLangs.length / 2);

function postFinal(job, out, draft = false) {
  post({ type: 'final', id: job.id, cut: !!job.cut, draft, parts: out.map(({ audio, r, p, ...o }) => o) }, draft ? [] : out.filter(o => o.pcm).map(o => o.pcm.buffer));
}
function partOut(job, p, i, n, r, text, audio, refined) {
  const unsure = refined ? isUnsure(r, text) : false;
  // Low-confidence sentences carry their audio back to the main thread for the optional cloud recheck
  const pcm = unsure && cfg.recheck ? toInt16(audio) : null;
  return { sub: i, text, conf: r.conf, unsure, pcm, speaker: p.speaker, startMs: job.startMs + p.start / 16, endMs: job.startMs + p.end / 16,
    dur: +(audio.length / 16000).toFixed(2), parts: n, lang: r.lang ?? null, model: r.model ?? null, audio, r };
}

/** Pass 2: send to the refine worker and replace in place when it returns; if too many are pending, finalize the oldest with its first-pass text */
function refineLater(job, out) {
  const entry = { job, out, jids: [] };
  inflight.push(entry);
  Promise.all(out.map((o, i) => {
    if (!engine.canRefine({ ...o.r, text: o.text })) return null;
    const jid = `${job.id}.${i}.${++refineSeq}`; entry.jids.push(jid);
    return engine.refine(o.audio, o.r, jid).catch(() => null);
  })).then(rs => {
    const k = inflight.indexOf(entry);
    if (k < 0) return; // already finalized with the first-pass text because of the backlog
    inflight.splice(k, 1);
    postFinal(job, out.map((o, i) => {
      const r = rs[i];
      if (!r || r === o.r) return { ...o, ...partOut(job, o.p, o.sub, out.length, o.r, o.text, o.audio, true) };
      return { ...partOut(job, o.p, o.sub, out.length, r, finishText(r), o.audio, true), p: o.p };
    }));
  });
  while (inflight.length > 3) {
    const old = inflight.shift();
    old.jids.forEach(j => engine.ref?.drop(j));
    postFinal(old.job, old.out.map(o => ({ ...o, ...partOut(old.job, o.p, o.sub, old.out.length, o.r, o.text, o.audio, true) })));
  }
}

async function pump() {
  if (busy || !engine) return;
  busy = true;
  try {
    while (finals.length || partial) {
      // Finals first, then partials; pass 2 runs in the other worker and costs no time here
      let job;
      if (finals.length) job = finals.shift();
      else if (performance.now() >= partialCooldownUntil) { job = partial; partial = null; }
      else { partial = null; continue; } // cooling down: skip this partial
      const t0 = performance.now();
      try {
        if (!job.final) {
          // For long segments the partial only decodes the last 5 seconds: bounded cost, never slows finals
          const long = job.audio.length > 16000 * 6;
          const a = long ? job.audio.subarray(job.audio.length - 16000 * 5) : job.audio;
          const r = engine.fast ? await engine.fast(a, { partial: true }) : await engine.transcribe(a, { partial: true });
          if (long) r.text = '…' + r.text;
          let text = cleanText(r.text, { lang: r.lang ?? cfg.sourceLang, engine: engine.name, conf: 1, corrections: cfg.corrections });
          if (EN_FILLER.test(text.replace(/^…/, '')) && jaZhContext()) text = '';
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
        const twoPass = !!(engine.fast && cfg.twoPass);
        const out = [];
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          const audio = job.audio.subarray(p.start, p.end);
          const r = twoPass ? await engine.fast(audio) : await engine.transcribe(audio);
          // Sentences that will be refined are not dropped on low first-pass confidence (SenseVoice is unsure about short words like '武将' or '昆布', the refine model is usually right)
          const text = finishText(twoPass && engine.canRefine(r) ? { ...r, conf: 1 } : r);
          if (text && r.lang && audio.length >= 16000 * 1.2) { recentLangs.push(r.lang); if (recentLangs.length > 8) recentLangs.shift(); }
          p.speaker = null;
          if (spk && text) {
            const emb = p.emb ?? normalize(await spk.embedder.embed(audio));
            p.speaker = spk.clusterer.assign(emb, audio.length / 16000);
          }
          out.push({ ...partOut(job, p, i, parts.length, r, text, audio, !twoPass || !engine.canRefine({ ...r, text })), p });
        }
        const needRefine = twoPass && out.some(o => engine.canRefine({ ...o.r, text: o.text }));
        if (!needRefine) { postFinal(job, out); continue; }
        postFinal(job, out, true); // publish the first-pass result as a subtitle first
        refineLater(job, out);
      } catch (err) {
        status('warn', t('识别出错：') + err.message);
        if (job.final) post({ type: 'final', id: job.id, parts: [] });
      }
    }
  } finally { busy = false; }
}
