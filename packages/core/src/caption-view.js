// Subtitle renderer (shared by the desktop overlay and the web page layer)
import { SPEAKER_COLORS, speakerName } from './speaker.js';
import { subtitleStyle, baseLang, guessLang } from './lang-text.js';

// Pick fonts by language: the same Han character has different glyphs in Chinese and Japanese (e.g. 直, 骨, 次), so the browser must know the language
export const CAPTION_CSS = `
.ls-wrap{display:flex;flex-direction:column;align-items:center;gap:5px;pointer-events:none;
  font-family:"Segoe UI","Noto Sans","Microsoft YaHei UI","PingFang SC",sans-serif;}
.ls-wrap :lang(ja){font-family:"Yu Gothic UI","Meiryo UI","Noto Sans JP","Noto Sans CJK JP","Hiragino Sans","Yu Gothic",sans-serif}
.ls-wrap :lang(zh-CN),.ls-wrap :lang(zh){font-family:"Microsoft YaHei UI","PingFang SC","Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC",sans-serif}
.ls-wrap :lang(zh-TW){font-family:"Microsoft JhengHei UI","PingFang TC","Noto Sans TC","Noto Sans CJK TC","Source Han Sans TC",sans-serif}
.ls-wrap :lang(ko){font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif}
.ls-line{position:relative;max-width:100%;box-sizing:border-box;padding:4px 14px;border-radius:8px;background:rgba(0,0,0,var(--ls-bg,.62));
  color:#fff;text-align:center;line-height:1.38;text-shadow:0 1px 2px #000,0 0 1px #000;transition:opacity .25s;
  text-wrap:balance;line-break:strict;word-break:normal;overflow-wrap:anywhere;hanging-punctuation:allow-end}
.ls-line :lang(en){overflow-wrap:break-word;hyphens:auto}
.ls-src{display:block;font-size:calc(var(--ls-font,28px) * .74);color:#e6e6e6;opacity:.95}
.ls-dst{display:block;font-size:var(--ls-font,28px);font-weight:600}
.ls-only{font-size:var(--ls-font,28px);font-weight:600}
.ls-partial{color:#bfe3ff}
.ls-pending{opacity:.55}
.ls-old{opacity:.62}
.ls-low{opacity:.7;font-style:italic}
.ls-who{display:inline-block;font-size:.62em;font-weight:600;padding:0 .45em;margin-right:.45em;border-radius:.5em;color:#111;vertical-align:.15em;font-style:normal}
.ls-status{font-size:13px;color:#ffd27a;background:rgba(0,0,0,.65);padding:3px 10px;border-radius:6px;max-width:100%}
.ls-err{font-size:.6em;color:#ffb0b0}
`;

const LANG_ATTR = { ja: 'ja', zh: 'zh-CN', en: 'en', ko: 'ko', yue: 'zh-HK' };
const isCjk = (l) => ['ja', 'zh', 'ko', 'yue'].includes(baseLang(l));

/**
 * Show only the tail of long lines (live-caption convention: the newest words matter most). Cut at punctuation/spaces when possible
 * @param {number} max max characters (CJK counted per character, English per letter)
 */
export function tailText(text, max) {
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.length - max;
  // look for a break point within 15 characters after the cut
  for (let i = cut; i < Math.min(chars.length - 4, cut + 15); i++) {
    if (/[、。，,.!?！？\s]/.test(chars[i])) return '…' + chars.slice(i + 1).join('').trimStart();
  }
  return '…' + chars.slice(cut).join('');
}

export class CaptionView {
  constructor(root, opts = {}) {
    this.root = root;
    this.maxLines = opts.maxLines ?? 2;
    this.display = opts.display ?? 'both';
    this.showSpeaker = opts.showSpeaker ?? true;
    this.layout = opts.layout ?? 'src-top';
    this.subtitlePunct = opts.subtitlePunct ?? true;
    this.maxChars = opts.maxChars ?? 0;
    this.sourceLang = opts.sourceLang ?? null;
    this.targetLang = opts.targetLang ?? null;
    this.items = new Map(); // key -> item
    this.status = '';
    this.hideTimer = null;
    this.wrap = document.createElement('div');
    this.wrap.className = 'ls-wrap';
    root.appendChild(this.wrap);
  }

  setOptions(o = {}) {
    for (const k of ['display', 'maxLines', 'showSpeaker', 'layout', 'subtitlePunct', 'maxChars', 'sourceLang', 'targetLang']) if (o[k] != null) this[k] = o[k];
    if (o.fontSize) this.root.style.setProperty('--ls-font', o.fontSize + 'px');
    if (o.bgOpacity != null) this.root.style.setProperty('--ls-bg', o.bgOpacity);
    this.render();
  }

  setStatus(text) { this.status = text ?? ''; this.render(); }

  update(c) {
    if (c.removed) this.items.delete(c.key);
    else {
      const it = this.items.get(c.key) ?? {};
      for (const k of ['text', 'final', 'speaker', 'conf', 'merged', 'lang', 'tlang']) if (c[k] !== undefined) it[k] = c[k];
      if (c.translation !== undefined) { it.translation = c.translation; it.pending = false; }
      else if (c.pendingTranslation) it.pending = true;
      if (c.translationError !== undefined) it.err = c.translationError;
      this.items.set(c.key, it);
      if (this.items.size > 12) {
        const keys = [...this.items.keys()].sort((a, b) => a - b);
        for (const k of keys.slice(0, this.items.size - 12)) this.items.delete(k);
      }
    }
    this.render();
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { this.items.clear(); this.render(); }, 15000);
  }

  clear() { this.items.clear(); this.render(); }

  visible() {
    const keys = [...this.items.keys()].sort((a, b) => a - b);
    return keys.map(k => [k, this.items.get(k)])
      .filter(([, it]) => it.text && !(this.display === 'target' && (it.merged || !it.final)))
      .slice(-this.maxLines);
  }

  /** Build a text span tagged with its language */
  _span(cls, text, lang, partial) {
    const L = lang ?? guessLang(text) ?? this.sourceLang;
    const max = this.maxChars || (isCjk(L) ? 44 : 90);
    let t = this.subtitlePunct ? subtitleStyle(text, L) : text;
    t = tailText(t, partial ? Math.round(max * 0.8) : max);
    const s = el('span', cls);
    const attr = LANG_ATTR[baseLang(L)] ?? (L === 'zh-TW' ? 'zh-TW' : L);
    if (L === 'zh-TW' || L === 'zh-CN') s.lang = L; else if (attr) s.lang = attr;
    s.append(t);
    return s;
  }

  render() {
    const frag = document.createDocumentFragment();
    if (this.status) frag.appendChild(el('div', 'ls-status', this.status));
    const vis = this.visible();
    vis.forEach(([, it], idx) => {
      const cls = 'ls-line' + (idx < vis.length - 1 ? ' ls-old' : '') + (it.final && it.conf != null && it.conf < 0.6 ? ' ls-low' : '');
      const box = el('div', cls);
      const color = it.final && it.speaker != null ? SPEAKER_COLORS[it.speaker % SPEAKER_COLORS.length] : null;
      const tag = () => {
        if (!color || !this.showSpeaker) return null;
        const w = el('span', 'ls-who', speakerName(it.speaker).replace('说话人', ''));
        w.style.background = color;
        return w;
      };
      const srcLang = it.lang ?? this.sourceLang;
      const dstLang = it.tlang ?? this.targetLang;
      const tr = it.translation;
      const hasTr = it.final && !it.merged && (tr || it.pending);
      if (this.display === 'both' && hasTr) {
        const s = this._span('ls-src', it.text, srcLang);
        const d = this._span('ls-dst' + (it.pending ? ' ls-pending' : ''), tr || '…', tr ? dstLang : null);
        const t = tag(); if (t) (this.layout === 'dst-top' ? d : s).prepend(t);
        if (color) { s.style.color = color; d.style.color = color; }
        if (this.layout === 'dst-top') box.append(d, s); else box.append(s, d);
      } else if (this.display === 'both' && it.final && it.merged) {
        // first half translated together with the next sentence: shown as a small source line, the translation appears on the next one
        const s = this._span('ls-src', it.text, srcLang);
        const t = tag(); if (t) s.prepend(t);
        if (color) s.style.color = color;
        box.appendChild(s);
      } else {
        const showTr = this.display === 'target' && it.final && (tr || it.pending);
        const s = showTr
          ? this._span('ls-only' + (it.pending && !tr ? ' ls-pending' : ''), tr || '…', tr ? dstLang : null)
          : this._span('ls-only' + (it.final ? '' : ' ls-partial'), it.text, srcLang, !it.final);
        const t = tag(); if (t) s.prepend(t);
        if (color) s.style.color = color;
        box.appendChild(s);
      }
      if (it.err && !tr && this.display !== 'source') box.appendChild(el('span', 'ls-err', ' ⚠ 翻译失败'));
      if (color) box.style.boxShadow = `inset 4px 0 0 ${color}`;
      frag.appendChild(box);
    });
    this.wrap.replaceChildren(frag);
  }
}

/** Display options derived from settings (shared by the overlay and the web layer) */
export function viewOptions(s) {
  return { display: s.display, fontSize: s.fontSize, bgOpacity: s.bgOpacity, maxLines: s.maxLines, showSpeaker: s.showSpeaker,
    layout: s.layout, subtitlePunct: s.subtitlePunct, maxChars: s.maxChars, sourceLang: s.sourceLang === 'auto' ? null : s.sourceLang, targetLang: s.targetLang };
}

function el(tag, cls, text) { const d = document.createElement(tag); d.className = cls; if (text != null) d.textContent = text; return d; }
