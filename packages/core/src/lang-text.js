// Language-related text helpers: language guessing, punctuation normalization, subtitle style
import { SIMP_ONLY, TRAD_ONLY, NOT_JA, toSimplified, countIn } from './zh-script.js';

const KANA = /[぀-ヿ]/g, HAN = /[㐀-鿿]/g, HANGUL = /[가-힯]/g, LATIN = /[A-Za-z]/g;
const count = (s, re) => (s.match(re) ?? []).length;

/** Rough language guess: ja / zh / en / ko / null */
export function guessLang(s) {
  const t = s ?? '';
  // English counted per word, CJK per character (one Han character is roughly one English word)
  const kana = count(t, KANA), han = count(t, HAN), hangul = count(t, HANGUL), words = count(t, /[A-Za-z]+/g);
  const n = kana + han + hangul + words;
  if (!n) return null;
  if (kana >= 1 && kana / Math.max(1, kana + han) > 0.1) return 'ja';
  if (hangul / n > 0.3) return 'ko';
  if (han / n >= 0.3) return 'zh';
  if (words / n > 0.6) return 'en';
  return null;
}

/** Map codes like zh-CN / zh-TW / ja / en to the base language */
export const baseLang = (code) => (code ?? '').split('-')[0];

const FW = { ',': '，', '?': '？', '!': '！', ':': '：', ';': '；', '(': '（', ')': '）' };
const HW = { '，': ', ', '。': '. ', '？': '? ', '！': '! ', '：': ': ', '；': '; ', '（': ' (', '）': ') ', '、': ', ', '「': ' "', '」': '" ', '『': ' "', '』': '" ', '“': ' "', '”': '" ' };

/**
 * Normalize punctuation and spacing for the target language
 *   - zh / ja: full-width punctuation; Chinese uses '，' and Japanese '、'; remove stray spaces between Han/kana
 *   - en: half-width punctuation, one space after punctuation
 */
export function normalizePunct(s, lang) {
  let t = (s ?? '').trim();
  const L = baseLang(lang);
  if (L === 'zh' || L === 'ja') {
    t = t.replace(/([぀-ヿ㐀-鿿])\s*([,?!:;])\s*/g, (_, a, p) => a + FW[p]);
    t = t.replace(/([぀-ヿ㐀-鿿])\s*\.(?=\s|$)/g, '$1。');
    if (L === 'ja') t = t.replace(/，/g, '、');
    else t = t.replace(/、(?=[^㐀-鿿]|$)/g, '，');
    t = t.replace(/(?<=[　-ヿ㐀-鿿＀-￯])\s+(?=[　-ヿ㐀-鿿＀-￯])/g, '');
  } else if (L === 'en') {
    t = t.replace(/[，。？！：；（）、「」『』“”]/g, c => HW[c]).replace(/\s{2,}/g, ' ').replace(/\s+([,.?!:;)])/g, '$1').replace(/\(\s+/g, '(').replace(/"\s+([^"]*?)\s*"/g, '"$1"').trim();
  }
  return t;
}

/** Subtitle style: drop the sentence-final period (CJK subtitle convention), keep ?/!; optionally turn Chinese commas into spaces */
export function subtitleStyle(s, lang, { dropPeriod = true, commaToSpace = false } = {}) {
  let t = s ?? '';
  const L = baseLang(lang);
  if (L === 'zh' || L === 'ja') {
    if (dropPeriod) t = t.replace(/[。．]+$/, '');
    if (commaToSpace && L === 'zh') t = t.replace(/[，、]/g, ' ').replace(/[。．](?=.)/g, ' ').replace(/\s{2,}/g, ' ');
  }
  return t;
}

/**
 * Check that a translation really is in the target language/script; fix what can be fixed (traditional -> simplified), otherwise return null
 */
export function checkTarget(out, src, target) {
  let t = out;
  const L = baseLang(target);
  const len = [...t].length, srcLen = [...src].length;
  const kana = count(t, KANA), han = count(t, HAN), latin = count(t, LATIN), hangul = count(t, HANGUL);
  if (L === 'zh') {
    if (kana / Math.max(1, len) > 0.15) return null;                 // still Japanese
    if (han === 0 && srcLen > 3 && count(src, LATIN) < srcLen * 0.5) return null;
    if (target === 'zh-CN' && countIn(t, TRAD_ONLY) > 0) t = toSimplified(t);  // traditional characters mixed in -> convert to simplified
    if (target === 'zh-TW' && countIn(t, SIMP_ONLY) >= 2) return null;        // simplified mixed into traditional -> try another engine
  } else if (L === 'ja') {
    if (han + kana >= 4 && kana === 0) return null;                  // only Han, no kana -> most likely Chinese
    if (countIn(t, NOT_JA) >= 2) return null;                       // contains simplified characters Japanese never uses
  } else if (L === 'en') {
    if (latin === 0 && srcLen > 3) return null;
    if ((han + kana) / Math.max(1, len) > 0.2) return null;
  } else if (L === 'ko') {
    if (hangul === 0 && srcLen > 3) return null;
  }
  return t;
}
