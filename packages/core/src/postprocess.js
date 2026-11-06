// Post-processing of recognition results: Whisper hallucination filter, repetition folding, Japanese space cleanup

// Sentences Whisper often invents during silence / BGM (YouTube end-credit lines in its training data)
const HALLUCINATIONS = [
  /^(ご視聴|ご清聴)(いただき)?ありがとうございま(した|す)[。!！]*$/,
  /^(ぜひ|是非)?(高評価(と|、)?)?チャンネル登録(と高評価)?(を)?(よろしく)?(お願い(します|いたします)?)?[。!！]*$/,
  /^(次回|また)(の動画)?(で|も)お会いしましょう[。!！]*$/,
  /^おやすみなさい[。!！]*$/,
  /^(字幕|翻訳)(制作|作成)?[:：]/,
  /^(by\s+)?H\.?\s*M\.?\s*$/i,
  /^thank(s| you) for watching[.!]*$/i,
  /^(please )?subscribe/i,
  /^subtitles? by/i,
  /^(请|請)不吝(点赞|點讚)/,
  /^字幕(由|by)/,
  /^(優優|明镜)/,
];

const MUSIC_ONLY = /^[\s♪♫🎵🎶\(\)（）\[\]【】「」『』。、,.!?！？…~〜ー-]*(音楽|拍手|笑い|music|applause|laughter|BGM)?[\s♪♫🎵🎶\(\)（）\[\]【】。、,.!?！？…~〜ー-]*$/i;

const CJK = '\\u3040-\\u30ff\\u3400-\\u9fff\\uff66-\\uff9f\\u3000-\\u303f\\uff01-\\uff0f\\uff1a-\\uff20';
const SPACE_BETWEEN_CJK = new RegExp(`(?<=[${CJK}])\\s+(?=[${CJK}])`, 'g');

export function isHallucination(text) {
  const t = text.trim();
  if (!t) return true;
  if (MUSIC_ONLY.test(t)) return true;
  return HALLUCINATIONS.some(r => r.test(t));
}

/** Fold repetitions: 「ですですですですです」 -> at most 2x 「です」; a whole sentence repeated 3+ times -> once */
export function collapseRepeats(text) {
  let t = text;
  // Single-character repeats (laughter 「ははははは」 is kept up to 4)
  t = t.replace(/(.)\1{4,}/gu, '$1$1$1$1');
  // Phrases of 2-12 characters repeated >= 3 times in a row
  t = t.replace(/(.{2,12}?)\1{2,}/gu, '$1');
  return t;
}

export function cleanText(text, lang) {
  let t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (lang === 'ja' || lang === 'zh' || lang === 'auto') t = t.replace(SPACE_BETWEEN_CJK, '');
  t = collapseRepeats(t);
  // Drop stray punctuation at the start of a sentence
  t = t.replace(/^[、。,.]+/, '').trim();
  return isHallucination(t) ? '' : t;
}
