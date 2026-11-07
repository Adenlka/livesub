// LLM prompts tailored per translation direction. Goal: subtitle-like output, nothing added, avoid common mistranslations
import { baseLang } from './lang-text.js';

const NAMES = { ja: '日语', zh: '中文', 'zh-CN': '简体中文', 'zh-TW': '繁体中文（台湾用语）', en: '英语', ko: '韩语', ms: '马来语' };
export const langLabel = (c) => NAMES[c] ?? NAMES[baseLang(c)] ?? c;

const COMMON = [
  '只输出一行译文本身：不要解释、注释、引号、注音、原文或“译文：”之类的前缀。',
  '忠实于原文，不补充原文没有的信息；原文是半句就只译这半句，不要自己补全。',
  '原文来自语音识别，可能有同音字错误：按上下文推断正确意思来译。',
  '译文要短、口语化、适合当字幕。语气词和口头禅译成对应的简短语气词。',
  '意思准确第一：不确定的地方宁可译得含糊、保守，也不要译出确定但可能错误的意思；原文前标有【识别可能有误】时，只译能确定的部分，读不通的词不要硬猜成别的意思。',
  '口语里常有语速快、连读、省略、倒装、说到一半改口：按说话人真正想表达的意思译，不要逐字直译。',
];

// direction-specific rules
const RULES = {
  'ja>zh': [
    '日语省略的主语、宾语按上下文补成自然的中文，但不要硬补“我/你”。',
    '日中同形词别直译：勉強=学习，手紙=信，大丈夫=没事/没问题，怪我=受伤，迷惑=麻烦，留守=不在家，切手=邮票，娘=女儿，丈夫=结实，邪魔=打扰，心中=殉情，人間=人类，汽車=火车，新聞=报纸，愛人=情人，結構=相当/不用了，無理=不行/勉强，一生懸命=拼命/努力。',
    '「〜さん」一般省略或译成“先生/小姐”；「先生」看语境译“老师/医生”；「お疲れ様」译“辛苦了”，「よろしくお願いします」按语境译“请多关照/拜托了”。',
    '片假名外来语译成中文常用说法（パソコン=电脑，コンビニ=便利店），没有通用译法的专有名词保留原文。',
    '「草」「w」「ｗｗｗ」是笑声，译“哈哈/笑死”；「えー」「あの」等填充词通常省略。',
    '敬语不用逐字体现，用中文的礼貌语气表达即可。',
  ],
  'zh>ja': [
    '日语要自然：会议/课堂用「です・ます」体，直播/视频用自然的口语体。',
    '只用日文汉字字形（発、気、図、駅…），绝对不要出现简体字（发、气、图、这、们…）。',
    '中国人名、地名保留汉字（改为日文字形），不要转成片假名；中文网络用语译成意思相同的日语表达（哈哈=笑/ｗ）。',
    '避开中日同形词误用：学习=勉強/学習，没问题=大丈夫，受伤=怪我，麻烦=迷惑/面倒，爱人(配偶)=妻/夫。',
  ],
  'ja>en': [
    'Fill in omitted subjects naturally; translate honorifics into natural English politeness rather than keeping -san/-sama, unless it is part of a name people use.',
    'Laughter like 「草」「w」 → "lol"; fillers like 「えー」「あの」 can be dropped.',
  ],
  'en>ja': ['会議/授業は「です・ます」体、配信/動画は自然な話し言葉で。カタカナ語は一般的なものだけ使う。'],
  'zh>en': ['把中文的口语和成语意译成自然英文，不要逐字翻译。中文人名用拼音。'],
  'en>zh': ['英文俚语和习语意译成自然的中文口语；人名、品牌、术语保留常用译名，没有通用译名就保留英文。'],
};

export function systemPrompt({ src, dst, scene, glossary = [], fix = false, title = '' }) {
  const s = baseLang(src), d = baseLang(dst);
  const key = `${s}>${d}`;
  const english = d === 'en' || (s === 'en' && d === 'ja');
  const head = english
    ? `You translate live ${scene ?? ''} subtitles from ${langLabel(src)} into ${langLabel(dst)}.`
    : `你是${scene ? scene + '场景的' : ''}实时字幕翻译，把${langLabel(src)}翻译成${langLabel(dst)}。`;
  const lines = [head, '规则：', ...COMMON.map((r, i) => `${i + 1}. ${r}`)];
  const extra = RULES[key] ?? [];
  extra.forEach((r, i) => lines.push(`${COMMON.length + i + 1}. ${r}`));
  if (dst === 'zh-TW') lines.push('使用台湾繁体字和台湾用语（软件=軟體，视频=影片，网络=網路，信息=資訊）。');
  if (glossary.length) lines.push('术语表（必须使用）：\n' + glossary.map(([a, b]) => `${a} → ${b || a}`).join('\n'));
  if (title) lines.push(`背景：正在观看的节目/直播标题是「${title.slice(0, 120)}」，人名、作品名、游戏名按标题里的写法。`);
  if (fix) lines.push(
    '输出格式：只输出一个 JSON 对象 {"src": "...", "dst": "..."}，不要输出别的。',
    `src = 改正语音识别错误后的${langLabel(src)}原文：只改明显听错的字词（同音/近音字、听错的人名和专有名词、术语表里的词、前后文能确定的词），不润色、不改语序、不补全、不删口头禅；没有把握就原样保留。`,
    'dst = 按改正后的原文翻出的译文（遵守上面的规则）。');
  return lines.join('\n');
}
