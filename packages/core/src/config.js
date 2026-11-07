// Languages, model catalog, scenario presets, default settings
export const SOURCE_LANGS = [
  { code: 'ja', name: '日语' },
  { code: 'zh', name: '中文' },
  { code: 'en', name: '英语' },
  { code: 'auto', name: '自动（中日英混合，逐句识别）' },
  { code: 'ko', name: '韩语' },
  { code: 'ms', name: '马来语（Whisper）' },
];

export const TARGET_LANGS = [
  { code: 'zh-CN', name: '简体中文', google: 'zh-CN', script: 'han' },
  { code: 'zh-TW', name: '繁體中文', google: 'zh-TW', script: 'han' },
  { code: 'en', name: 'English', google: 'en', script: 'latin' },
  { code: 'ja', name: '日本語', google: 'ja', script: 'ja' },
  { code: 'ko', name: '한국어', google: 'ko', script: 'hangul' },
  { code: 'ms', name: 'Bahasa Melayu', google: 'ms', script: 'latin' },
];
export const langName = (code) =>
  (TARGET_LANGS.find(l => l.code === code) ?? SOURCE_LANGS.find(l => l.code === code))?.name ?? code;

// --- model catalog ---
// Files come from Hugging Face (or a mirror); GitHub Releases as a fallback (extension / desktop main process only, web pages hit CORS)
export const MODELS = {
  'parakeet-ja': {
    name: 'Parakeet 日语（0.6B）', size: 656e6, repo: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8',
    files: ['model.int8.onnx', 'tokens.txt'],
  },
  'sensevoice': {
    name: 'SenseVoice 中英日（0.2B）', size: 239e6, repo: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
    files: ['model.int8.onnx', 'tokens.txt'],
  },
  'zipformer-zh': {
    name: 'Zipformer 中文（精识别）', size: 367e6, repo: 'csukuangfj/sherpa-onnx-zipformer-ctc-zh-int8-2025-07-03',
    files: ['model.int8.onnx', 'tokens.txt'],
  },
  'parakeet-en': {
    name: 'Parakeet-TDT 英语（0.6B）', size: 661e6, repo: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
    files: ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'],
  },
  'campplus': {
    name: '说话人声纹 CAM++', size: 28e6, repo: 'csukuangfj/speaker-embedding-models',
    files: ['3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx'],
    github: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/',
  },
};
export const MODEL_HOSTS = {
  hf: 'https://huggingface.co',
  mirror: 'https://hf-mirror.com',
};
export function modelUrls(id, file, host = 'hf') {
  const m = MODELS[id];
  const base = MODEL_HOSTS[host] ?? host;
  const urls = [`${base.replace(/\/$/, '')}/${m.repo}/resolve/main/${file}`];
  if (host !== 'hf') urls.push(`${MODEL_HOSTS.hf}/${m.repo}/resolve/main/${file}`);
  if (m.github) urls.push(m.github + file);
  return urls;
}

// Recognition engines (re-evaluated on real conversational speech: TV, YouTube, meetings, earnings calls, dialect chat):
//     Japanese: Parakeet-ja -- ~10% CER on real speech (SenseVoice: 22% on TV shows)
//     Chinese:  Zipformer-zh text + SenseVoice punctuation/digits -- meetings 7.1% / web video 5.3% (SenseVoice alone 8.9% / 7.2%)
//     English:  Parakeet-TDT-en -- meetings 10.8% / YouTube 12.1% (SenseVoice 15.3% / 16.4%)
//   Auto: SenseVoice detects the language per sentence, then hands it to that language's refine model (loaded in the background; SenseVoice results are used until it is ready)
export const ENGINES = [
  { id: 'auto', name: '自动（推荐，各语言用最准的模型）' },
  { id: 'sensevoice', name: '轻量：只用 SenseVoice（约 240MB，准确率略低）' },
  { id: 'whisper-turbo', name: 'Whisper large-v3-turbo（多语言，需要显卡，约 1GB）' },
  { id: 'whisper-small', name: 'Whisper small（多语言，约 250MB）' },
];
export const WHISPER_MODELS = {
  'whisper-turbo': { id: 'onnx-community/whisper-large-v3-turbo', dtype: { webgpu: { encoder_model: 'fp16', decoder_model_merged: 'q4' }, wasm: 'q8' }, gpu: true },
  'whisper-small': { id: 'onnx-community/whisper-small', dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: 'q8' } },
  'whisper-base': { id: 'onnx-community/whisper-base', dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: 'q8' } },
};
const SV_LANGS = new Set(['zh', 'en', 'ja', 'ko', 'auto']);
export const REFINE_MODEL = { ja: 'parakeet-ja', zh: 'zipformer-zh', en: 'parakeet-en' };
/**
 * @returns {{primary:string, refine:string[]}}
 *     primary = main engine; refine = languages whose sentences are passed to that language's refine model (REFINE_MODEL)
 */
export function resolveEngine(engine, lang) {
  if (engine === 'auto' || engine === 'parakeet-ja') { // parakeet-ja: legacy setting, same as auto
    if (lang === 'ja') return { primary: 'parakeet-ja', refine: [] };
    if (lang === 'en') return { primary: 'parakeet-en', refine: [] };
    if (lang === 'zh') return { primary: 'sensevoice', refine: ['zh'] };
    if (lang === 'auto') return { primary: 'sensevoice', refine: ['ja', 'zh', 'en'] };
    if (SV_LANGS.has(lang)) return { primary: 'sensevoice', refine: [] };
    return { primary: 'whisper-small', refine: [] };
  }
  if (engine === 'sensevoice' && !SV_LANGS.has(lang)) return { primary: 'whisper-small', refine: [] };
  return { primary: engine, refine: [] };
}
/** Model files a settings combination needs (the desktop app pre-downloads these) */
export function requiredModels(s) {
  const { primary, refine } = resolveEngine(s.engine, s.sourceLang);
  const ids = [];
  if (MODELS[primary]) ids.push(primary);
  for (const l of refine) if (!ids.includes(REFINE_MODEL[l])) ids.push(REFINE_MODEL[l]);
  if (s.diarize) ids.push('campplus');
  return ids;
}

// --- scenario presets --- (parameters tuned on synthetic scenario evaluations)
export const SCENES = {
  live:    { name: '直播', desc: '主播说话、有背景音乐', silenceMs: 550, maxSegmentMs: 8000, diarize: true, splitTurns: false, translateHoldMs: 1200 },
  video:   { name: '视频', desc: 'YouTube、电视剧、动画', silenceMs: 650, maxSegmentMs: 9000, diarize: true, splitTurns: true, translateHoldMs: 1200 },
  meeting: { name: '会议', desc: '多人轮流发言、换人快', silenceMs: 550, maxSegmentMs: 8000, diarize: true, splitTurns: true, translateHoldMs: 1500 },
  lecture: { name: '课堂/讲座', desc: '一个人长时间讲', silenceMs: 700, maxSegmentMs: 12000, diarize: false, splitTurns: false, translateHoldMs: 2000 },
};
export const SCENE_KEYS = ['silenceMs', 'maxSegmentMs', 'diarize', 'splitTurns', 'translateHoldMs'];

export const DEFAULT_SETTINGS = {
  scene: 'video',
  sourceLang: 'ja',
  engine: 'auto',
  customModel: '',
  device: 'auto',          // auto | webgpu | wasm (Whisper only)
  modelHost: 'hf',         // hf | mirror | custom URL
  vad: true,               // Silero VAD (energy threshold when off)
  translate: true,
  targetLang: 'zh-CN',
  reverseLang: '',         // two-way mode: sentences already in the target language are translated into this one ('' = don't)
  translator: 'google',    // none | google | openai
  openaiBaseUrl: 'https://api.deepseek.com/v1',
  openaiApiKey: '',
  openaiModel: 'deepseek-chat',
  asrFix: true,            // AI proofreading (when an LLM translates, it also fixes recognition errors from context)
  topic: '',               // what is being watched (streamer / game); used with the extension's tab title as hotwords and translation context
  glossary: '',            // glossary: one 'source=translation' per line (sources double as hotwords)
  corrections: '',         // corrections: one 'wrong=right' per line
  speakerThreshold: 0.5,
  display: 'both',         // both | source | target
  layout: 'src-top',       // src-top: small source line on top; dst-top: translation on top
  subtitlePunct: true,     // subtitle-style punctuation: no sentence-final period in Chinese/Japanese
  maxChars: 0,             // max characters per caption (0 = auto: CJK 44 / English 90); longer text shows the tail
  showSpeaker: true,
  maxLines: 2,
  fontSize: 28,
  bgOpacity: 0.62,
  autoSave: true,          // Desktop: autosave the transcript
  ...SCENES.video,
};

export function applyScene(settings, scene) {
  const s = SCENES[scene];
  if (!s) return { ...settings, scene: 'custom' };
  const next = { ...settings, scene };
  for (const k of SCENE_KEYS) next[k] = s[k];
  return next;
}
