// Recognition post-processing

// Sentences Whisper invents during silence / BGM (YouTube outro captions from its training data)
// Note: Whisper only. Parakeet doesn't hallucinate like this, and deleting real content would cost more
const WHISPER_HALLUCINATIONS = [
  /^(ご視聴|ご清聴)(いただき)?(、)?(本当に)?ありがとうございま(した|す)[。!！]*$/,
  /^(ぜひ|是非)?(高評価(と|、)?)?チャンネル登録(と高評価)?(を)?(よろしく)?(お願い(します|いたします)?)?[。!！]*$/,
  /^(次回|また)(の動画)?(で|も)お会いしましょう[。!！]*$/,
  /^(字幕|翻訳)(制作|作成)?[:：]/,
  /^thank(s| you) for watching[.!]*$/i,
  /^(please )?subscribe/i,
  /^subtitles? by/i,
  /^(请|請)不吝(点赞|點讚)/,
  /^字幕(由|by)/,
];

const MUSIC_ONLY = /^[\s♪♫🎵🎶\(\)（）\[\]【】「」『』。、,.!?！？…~〜ー-]*(音楽|拍手|笑い|music|applause|laughter|BGM)?[\s♪♫🎵🎶\(\)（）\[\]【】。、,.!?！？…~〜ー-]*$/i;
const CJK = '\\u3040-\\u30ff\\u3400-\\u9fff\\uff66-\\uff9f\\u3000-\\u303f\\uff01-\\uff0f\\uff1a-\\uff20';
const SPACE_BETWEEN_CJK = new RegExp(`(?<=[${CJK}])\\s+(?=[${CJK}])`, 'g');
const PUNCT_ONLY = /^[\s\p{P}\p{S}]*$/u;

export function isHallucination(text) {
  const t = text.trim();
  if (!t || MUSIC_ONLY.test(t)) return true;
  return WHISPER_HALLUCINATIONS.some(r => r.test(t));
}

/** Collapse recognizer repetition loops: 'ですですですです', 'そうそうそうそう' */
export function collapseRepeats(text) {
  let t = text.replace(/(.)\1{4,}/gu, '$1$1$1$1');
  t = t.replace(/(.{2,12}?)\1{2,}/gu, '$1');
  return t;
}

/** Parse line-based 'a=b' rules */
export function parsePairs(text) {
  return (text ?? '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    .filter(([a]) => a);
}

export function applyCorrections(text, corrections) {
  let t = text;
  for (const [a, b] of corrections) t = t.split(a).join(b);
  return t;
}

/**
 * @param {string} text
 * @param {{lang?:string, engine?:string, conf?:number, corrections?:[string,string][]}} o
 * @returns {string} empty string means drop
 */
export function cleanText(text, { lang = 'ja', engine = 'parakeet-ja', conf = 1, corrections = [] } = {}) {
  let t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (lang === 'ja' || lang === 'zh' || lang === 'auto') t = t.replace(SPACE_BETWEEN_CJK, '');
  t = collapseRepeats(t);
  t = t.replace(/^[、。,.]+/, '').trim();
  if (PUNCT_ONLY.test(t)) return '';
  // Very short and unsure ('あっ', 'うん' popping out of music/breathing; measured confidence 0.47-0.86, a real 'はい' is usually >= 0.95)
  const core = t.replace(/[\p{P}\p{S}\s]/gu, '');
  if ([...core].length <= 2 && conf < 0.9) return '';
  if (engine.startsWith('whisper') && isHallucination(t)) return '';
  if (MUSIC_ONLY.test(t)) return '';
  return corrections.length ? applyCorrections(t, corrections) : t;
}

// --- sentence completeness (decides whether translation waits for the next segment) ---
// Parakeet ends every segment with '。', so punctuation can't be trusted; look at Japanese continuative endings instead
const JA_CONTINUES = /(と|が|て|で|に|を|は|も|の|や|へ|から|けど|けれど|ので|のに|し|り|ば|たら|なら|ながら|ため|より|まで|って|という|ような|ように|そして|それで|でも|だけど|あと|、)$/;
export function looksIncomplete(text, lang = 'ja') {
  const t = (text ?? '').trim().replace(/[。．.]+$/, '');
  if (!t) return false;
  if (/[？?！!]$/.test(t)) return false;
  if (lang === 'ja') return JA_CONTINUES.test(t);
  if (lang === 'en') return /\b(and|or|but|the|a|an|to|of|in|on|with|that|which|because|so|if|when)$/i.test(t) || /,$/.test(t);
  if (lang === 'zh') return /[，、的地得和与或但而且并在把被让给对从向]$/.test(t);
  return false;
}

/** Strip leading fillers before translating (the caption itself keeps them) */
const JA_FILLERS = /^((えー+と?|えっと|あのー*|あの|まあ|うーん|んー|ええと|そのー)[、,\s]*)+/;
export function stripFillers(text, lang = 'ja') {
  return lang === 'ja' ? text.replace(JA_FILLERS, '').trim() : text;
}

/** Pick likely proper nouns (streamer, game, show names) from a page/stream title as recognition hotwords */
const TITLE_STOP = new Set(['配信', '雑談', '実況', '生放送', '公式', '切り抜き', '直播', '视频', '視頻', '实况', '录播', '合集', 'live', 'stream', 'youtube', 'twitch', 'bilibili', 'official', 'video', 'part', 'with', 'the', 'and', 'for', 'vtuber', 'shorts', '初見', '新人', '歌枠', '朝活', '耐久', '記念', '第', '回']);
export function titleTerms(title, max = 12) {
  if (!title) return [];
  const t = title.normalize('NFKC').replace(/\s+\/\s+/g, ' ').replace(/\s*[-|｜–—]\s*(YouTube|Twitch|bilibili|哔哩哔哩.*|ニコニコ.*)$/i, '');
  const out = [];
  const add = (w) => { w = w.trim(); if (w.length >= 2 && w.length <= 16 && !TITLE_STOP.has(w.toLowerCase()) && !out.includes(w)) out.push(w); };
  for (const m of t.matchAll(/[ァ-ヶー]{3,}|[\p{Script=Han}々]{2,8}(?![ぁ-ゖ])|[A-Z][A-Za-z0-9'.]+(?:\s[A-Z][A-Za-z0-9']+)*|[a-z]+[A-Z0-9][A-Za-z0-9]*/gu)) {
    let w = m[0];
    if (/^[A-Za-z]/.test(w)) { add(w); continue; }
    for (const st of ['配信', '実況', '直播', '实况', '雑談', '切り抜き']) w = w.split(st).join(' ');
    w.split(' ').forEach(add);
  }
  return out.filter(w => !/^[\p{Script=Han}]+$/u.test(w) || w.length <= 6).slice(0, max);
}
