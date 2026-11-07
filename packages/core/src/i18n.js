// UI in three languages (zh/ja/en) following the OS language; any other OS language uses English
// Usage: t('Chinese source text', {vars}) -- the Chinese source text is the key; Japanese/English translations live in i18n-dict.js
import { DICT } from './i18n-dict.js';

export function detectUiLang(locale) {
  const l = String(locale ?? (typeof navigator !== 'undefined' ? navigator.language : '') ?? '').toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('ja')) return 'ja';
  return 'en';
}

let LANG = detectUiLang();
export const uiLang = () => LANG;
export function setUiLang(l) { LANG = ['zh', 'ja', 'en'].includes(l) ? l : detectUiLang(l); }

const fill = (s, vars) => vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;

/** Translate one string; return it unchanged if not found (the Chinese UI uses the source text directly) */
export function t(zh, vars) {
  if (LANG === 'zh' || zh == null) return fill(String(zh ?? ''), vars);
  const e = DICT[zh];
  const s = e ? (LANG === 'ja' ? e[0] : e[1]) : zh;
  return fill(s, vars);
}

/** Translate the Chinese text/tooltips in a DOM subtree into the current UI language (for static HTML and form templates) */
export function translateDOM(root) {
  if (LANG === 'zh' || !root) return;
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const raw = n.nodeValue, s = raw.trim();
    if (!s || !/[㐀-鿿]/.test(s)) continue;
    const tr = t(s);
    if (tr !== s) n.nodeValue = raw.replace(s, tr);
  }
  for (const el of root.querySelectorAll('[title],[placeholder]')) {
    for (const a of ['title', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && /[㐀-鿿]/.test(v)) el.setAttribute(a, t(v));
    }
  }
}
