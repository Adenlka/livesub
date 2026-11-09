// UI language follows the OS: Chinese / Japanese / English / Korean; any other locale falls back to English.
// Usage: t('English source text', { vars }) — the English text is the key; translations live in i18n-dict.js.
import { DICT } from './i18n-dict.js';

export function detectUiLang(locale) {
  const l = String(locale ?? (typeof navigator !== 'undefined' ? navigator.language : '') ?? '').toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('ko')) return 'ko';
  return 'en';
}

let LANG = detectUiLang();
export const uiLang = () => LANG;
export function setUiLang(l) { LANG = ['zh', 'ja', 'en', 'ko'].includes(l) ? l : detectUiLang(l); }

const fill = (s, vars) => vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
const COL = { zh: 0, ja: 1, ko: 2 };

/** Translate one string; unknown strings are returned unchanged. */
export function t(en, vars) {
  if (en == null) return '';
  const s = String(en);
  if (LANG === 'en') return fill(s, vars);
  const e = DICT[s];
  return fill(e ? e[COL[LANG]] : s, vars);
}

/** Translate text nodes and title/placeholder attributes inside a DOM subtree (static HTML, form templates). */
export function translateDOM(root) {
  if (LANG === 'en' || !root) return;
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const raw = n.nodeValue, s = raw.trim();
    if (!s || !DICT[s]) continue;
    n.nodeValue = raw.replace(s, t(s));
  }
  for (const el of root.querySelectorAll('[title],[placeholder]')) {
    for (const a of ['title', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && DICT[v]) el.setAttribute(a, t(v));
    }
  }
}
