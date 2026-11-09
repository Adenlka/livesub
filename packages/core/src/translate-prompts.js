// LLM prompts tailored per translation direction. Goal: subtitle-like output, nothing added, avoid common mistranslations
import { baseLang } from './lang-text.js';

const NAMES = { ja: 'Japanese', zh: 'Chinese', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese (Taiwan usage)', en: 'English', ko: 'Korean', ms: 'Malay' };
export const langLabel = (c) => NAMES[c] ?? NAMES[baseLang(c)] ?? c;

/** Marker prepended to sources with low recognition confidence */
export const UNSURE_MARK = '[POSSIBLY MISHEARD]';

const COMMON = [
  'Output only the translation, on one line: no explanations, notes, quotes, readings, source text or prefixes like "Translation:".',
  'Stay faithful to the source and add nothing; if the source is half a sentence, translate only that half without completing it.',
  'The source comes from speech recognition and may contain homophone errors: infer the intended meaning from context.',
  'Keep translations short and colloquial, suitable as subtitles. Render fillers and interjections as short equivalents.',
  `Accuracy of meaning comes first: where unsure, be vague and conservative rather than confidently wrong. When the source starts with ${UNSURE_MARK}, translate only what is certain and do not guess unclear words into something else.`,
  'Spoken language is fast, slurred, elliptical, inverted and self-correcting: translate what the speaker actually means, not word by word.',
  'Never intensify or soften the source (e.g. "harmed them" must not become "killed them", "a bit" must not become "very"); if the source is cut off, stop there too and add no comment.',
];

// direction-specific rules (the CJK examples are part of the instructions)
const RULES = {
  'ja>zh': [
    'Restore subjects/objects omitted in Japanese naturally in Chinese, but do not force in 我/你.',
    'Do not translate Japanese-Chinese false friends literally: 勉強=学习, 手紙=信, 大丈夫=没事/没问题, 怪我=受伤, 迷惑=麻烦, 留守=不在家, 切手=邮票, 娘=女儿, 丈夫=结实, 邪魔=打扰, 心中=殉情, 人間=人类, 汽車=火车, 新聞=报纸, 愛人=情人, 結構=相当/不用了, 無理=不行/勉强, 一生懸命=拼命/努力.',
    '「〜さん」 is usually dropped or rendered 先生/小姐; 「先生」 is 老师 or 医生 depending on context; 「お疲れ様」 = 辛苦了; 「よろしくお願いします」 = 请多关照/拜托了 depending on context.',
    'Render katakana loanwords with the usual Chinese terms (パソコン=电脑, コンビニ=便利店); keep proper nouns without a standard translation as-is.',
    '「草」「w」「ｗｗｗ」 are laughter: 哈哈/笑死. Fillers like 「えー」「あの」 are usually dropped.',
    'Do not mirror keigo word by word; convey politeness with natural Chinese tone.',
  ],
  'zh>ja': [
    'Write natural Japanese: です・ます for meetings/classes, natural casual speech for streams/videos.',
    'Use Japanese kanji forms only (発, 気, 図, 駅...), never simplified Chinese characters (发, 气, 图, 这, 们...).',
    'Keep Chinese personal and place names in kanji (Japanese forms), not katakana; render Chinese internet slang with Japanese equivalents (哈哈=笑/ｗ).',
    'Avoid misusing false friends: 学习=勉強/学習, 没问题=大丈夫, 受伤=怪我, 麻烦=迷惑/面倒, 爱人 (spouse)=妻/夫.',
  ],
  'ja>en': [
    'Fill in omitted subjects naturally; translate honorifics into natural English politeness rather than keeping -san/-sama, unless it is part of a name people use.',
    'Laughter like 「草」「w」 → "lol"; fillers like 「えー」「あの」 can be dropped.',
  ],
  'en>ja': ['Use です・ます for meetings/classes and natural spoken Japanese for streams/videos. Only use common katakana loanwords.'],
  'zh>en': ['Translate Chinese colloquialisms and idioms into natural English by meaning, not word by word. Use pinyin for Chinese names.'],
  'en>zh': ['Render English slang and idioms as natural spoken Chinese; keep established translations for names, brands and terms, or keep the English when there is none.'],
  'ko>zh': ['Express Korean honorific levels (-요/-습니다) with a natural degree of politeness in the target language; keep the usual spelling of Korean names.'],
  'ko>ja': ['Express Korean honorific levels (-요/-습니다) with a natural degree of politeness in the target language; keep the usual spelling of Korean names.'],
  'ko>en': ['Express Korean honorific levels (-요/-습니다) with a natural degree of politeness in the target language; keep the usual spelling of Korean names.'],
};

export function systemPrompt({ src, dst, scene, glossary = [], fix = false, title = '' }) {
  const s = baseLang(src), d = baseLang(dst);
  const head = `You translate live ${scene ? scene.toLowerCase() + ' ' : ''}subtitles from ${langLabel(src)} into ${langLabel(dst)}.`;
  const common = fix ? ['Do not add explanations, notes, readings or prefixes like "Translation:" to the translation.', ...COMMON.slice(1)] : COMMON;
  const lines = [head, 'Rules:', ...common.map((r, i) => `${i + 1}. ${r}`)];
  const extra = RULES[`${s}>${d}`] ?? [];
  extra.forEach((r, i) => lines.push(`${common.length + i + 1}. ${r}`));
  if (dst === 'zh-TW') lines.push('Use Traditional Chinese characters and Taiwan usage (软件=軟體, 视频=影片, 网络=網路, 信息=資訊).');
  if (glossary.length) lines.push('Glossary (must be used):\n' + glossary.map(([a, b]) => `${a} → ${b || a}`).join('\n'));
  if (title) lines.push(`Context: the show / stream being watched is titled "${title.slice(0, 120)}"; write names of people, works and games as they appear in the title.`);
  if (fix) lines.push(
    'Output format: a single JSON object {"src": "...", "dst": "..."} and nothing else.',
    `src = the ${langLabel(src)} source with speech-recognition errors fixed: only change clearly misheard words (homophones/near-homophones, misheard names and proper nouns, glossary terms, words the context makes certain). Do not polish, reorder, complete or remove fillers; when unsure, keep it as is.`,
    'dst = the translation of the corrected source (following the rules above).');
  return lines.join('\n');
}
