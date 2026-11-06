// Recognition languages (Whisper language codes) and translation target languages
export const SOURCE_LANGS = [
  { code: 'ja', name: '日语' },
  { code: 'en', name: '英语' },
  { code: 'zh', name: '中文' },
  { code: 'ko', name: '韩语' },
  { code: 'ms', name: '马来语' },
  { code: 'auto', name: '自动检测' },
];

export const TARGET_LANGS = [
  { code: 'zh-CN', name: '简体中文', google: 'zh-CN' },
  { code: 'zh-TW', name: '繁體中文', google: 'zh-TW' },
  { code: 'en', name: 'English', google: 'en' },
  { code: 'ja', name: '日本語', google: 'ja' },
  { code: 'ko', name: '한국어', google: 'ko' },
  { code: 'ms', name: 'Bahasa Melayu', google: 'ms' },
];

export const langName = (code) =>
  (TARGET_LANGS.find(l => l.code === code) ?? SOURCE_LANGS.find(l => l.code === code))?.name ?? code;

// Recognition model presets. Japanese first: with WebGPU default to large-v3-turbo (much better Japanese than small)
export const MODEL_PRESETS = [
  { id: 'onnx-community/whisper-large-v3-turbo', name: 'Whisper large-v3-turbo（日语最佳，需要显卡）', size: '~1 GB', gpu: true,
    dtype: { webgpu: { encoder_model: 'fp16', decoder_model_merged: 'q4' }, wasm: 'q8' } },
  { id: 'onnx-community/whisper-small', name: 'Whisper small（均衡，无显卡也能跑）', size: '~250 MB', gpu: false,
    dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: 'q8' } },
  { id: 'onnx-community/whisper-base', name: 'Whisper base（最快，日语准确率一般）', size: '~80 MB', gpu: false,
    dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: 'q8' } },
];

export const DEFAULT_SETTINGS = {
  sourceLang: 'ja',
  model: 'auto',          // auto = turbo with WebGPU, otherwise small
  customModel: '',
  device: 'auto',         // auto | webgpu | wasm
  translate: true,
  targetLang: 'zh-CN',
  translator: 'google',   // none | google | openai
  openaiBaseUrl: 'https://api.deepseek.com/v1',
  openaiApiKey: '',
  openaiModel: 'deepseek-chat',
  diarize: true,          // Use different colors for different speakers
  speakerThreshold: 0.45, // Higher splits one person into two more easily, lower merges two people more easily
  display: 'both',
  bgOpacity: 0.62,        // both | source | target
  fontSize: 28,
  silenceMs: 550,
  maxSegmentMs: 9000,
};
