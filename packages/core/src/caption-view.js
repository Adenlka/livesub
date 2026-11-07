// Subtitle renderer (shared by the desktop overlay and the web page layer)
import { SPEAKER_COLORS, speakerName } from './speaker.js';
import { t } from './i18n.js';
import { subtitleStyle, baseLang, guessLang } from './lang-text.js';

// Pick fonts by language: the same Han character has different glyphs in Chinese and Japanese (e.g. 直, 骨, 次), so the browser must know the language
export const CAPTION_CSS = `
.ls-wrap{display:flex;flex-direction:column;align-items:center;gap:5px;pointer-events:none;
  font-size:var(--ls-font,28px);
  font-family:"Segoe UI","Noto Sans","Microsoft YaHei UI","PingFang SC",sans-serif;}
.ls-wrap :lang(ja){font-family:"Yu Gothic UI","Meiryo UI","Noto Sans JP","Noto Sans CJK JP","Hiragino Sans","Yu Gothic",sans-serif}
.ls-wrap :lang(zh-CN),.ls-wrap :lang(zh){font-family:"Microsoft YaHei UI","PingFang SC","Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC",sans-serif}
.ls-wrap :lang(zh-TW){font-family:"Microsoft JhengHei UI","PingFang TC","Noto Sans TC","Noto Sans CJK TC","Source Han Sans TC",sans-serif}
.ls-wrap :lang(ko){font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif}
/* Fixed subtitle box: fixed width, height reserved per sentence, lines stack from the bottom so the box doesn't jump around */
.ls-box{width:var(--ls-w,80%);box-sizing:border-box;padding:6px 16px;border-radius:10px;background:rgba(0,0,0,var(--ls-bg,.62));
  display:flex;flex-direction:column;justify-content:flex-end;gap:4px;min-height:var(--ls-minh,0);transition:opacity .3s}
.ls-box.ls-empty{opacity:0}
.ls-line{position:relative;max-width:100%;box-sizing:border-box;
  color:#fff;text-align:center;line-height:1.38;text-shadow:0 1px 2px #000,0 0 1px #000;transition:opacity .25s;
  text-wrap:balance;line-break:strict;word-break:normal;overflow-wrap:anywhere;hanging-punctuation:allow-end}
.ls-line :lang(en){overflow-wrap:break-word;hyphens:auto}
.ls-src{display:block;font-size:calc(var(--ls-font,28px) * .74);color:#e6e6e6;opacity:.95}
.ls-dst{display:block;font-size:var(--ls-font,28px);font-weight:600}
.ls-only{font-size:var(--ls-font,28px);font-weight:600}
.ls-partial{color:#bfe3ff}
.ls-pending{opacity:.55}
.ls-old{opacity:.7}
.ls-who{display:inline-block;font-size:.62em;font-weight:600;padding:0 .45em;margin-right:.45em;border-radius:.5em;color:#111;vertical-align:.15em;font-style:normal}
.ls-status{font-size:13px;color:#ffd27a;background:rgba(0,0,0,.65);padding:3px 10px;border-radius:6px;max-width:100%}
.ls-err{font-size:.6em;color:#ffb0b0}
`;

const OLD_TTL = 6000;
const MIN_TR_MS = 3500;
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
    this.diarize = opts.diarize ?? false;
    this.items = new Map(); // key -> item
    this.status = '';
    this.hideTimer = null;
    this.wrap = document.createElement('div');
    this.wrap.className = 'ls-wrap';
    root.appendChild(this.wrap);
  }

  setOptions(o = {}) {
    for (const k of ['display', 'maxLines', 'showSpeaker', 'layout', 'subtitlePunct', 'maxChars', 'sourceLang', 'targetLang', 'diarize']) if (o[k] != null) this[k] = o[k];
    if (o.boxWidth) this.root.style.setProperty('--ls-w', o.boxWidth + '%');
    if (o.fontSize) this.root.style.setProperty('--ls-font', o.fontSize + 'px');
    if (o.bgOpacity != null) this.root.style.setProperty('--ls-bg', o.bgOpacity);
    this.render();
  }

  setStatus(text) { this.status = text ?? ''; this.render(); }

  update(c) {
    if (c.removed) this.items.delete(c.key);
    else {
      const it = this.items.get(c.key) ?? {};
      it.ts = Date.now();
      for (const k of ['text', 'final', 'cont', 'speaker', 'conf', 'unsure', 'merged', 'lang', 'tlang']) if (c[k] !== undefined) it[k] = c[k];
      if (c.translation !== undefined) { it.translation = c.translation; it.pending = false; it.trTs = Date.now(); }
      else if (c.pendingTranslation) it.pending = true;
      if (c.translationError !== undefined) it.err = c.translationError;
      this.items.set(c.key, it);
      if (this.items.size > 12) {
        const keys = [...this.items.keys()].sort((a, b) => a - b);
        for (const k of keys.slice(0, this.items.size - 12)) this.items.delete(k);
      }
    }
    this.render();
    clearTimeout(this.oldTimer);
    this.oldTimer = setTimeout(() => this.render(), OLD_TTL + 50);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { this.items.clear(); this.render(); }, 15000);
  }

  clear() { this.items.clear(); this.render(); }

  /**
   * Join an unfinished half-sentence (cont / merged) with the same speaker's next segment into one caption:
   * one sentence = one source line + one translation line, never split across boxes or with its translation attached to another half
   */
  groups() {
    const keys = [...this.items.keys()].sort((a, b) => a - b);
    const out = [];
    for (const k of keys) {
      const it = this.items.get(k);
      if (!it.text) continue;
      const g = out.at(-1);
      const lenOf = (x) => [...x.text].length;
      const cap = this.maxChars || (isCjk(it.lang ?? this.sourceLang) ? 44 : 90);
      // don't join if the result is too long (only the tail would be visible and the first half would be cut off)
      const joinable = g && g.open && g.parts.length < 3 && g.parts.reduce((a, p) => a + lenOf(p), 0) + lenOf(it) <= cap && (it.speaker == null || g.speaker == null || it.speaker === g.speaker)
        && Date.now() - g.last.ts < 8000;
      if (joinable) g.parts.push(it); else out.push({ key: k, parts: [it] });
      const cur = out.at(-1);
      cur.last = it; cur.speaker = cur.parts[0].speaker;
      cur.open = it.final && (it.cont || it.merged);
    }
    return out.map(({ key, parts }) => {
      if (parts.length === 1) return [key, parts[0]];
      const last = parts.at(-1);
      const lang = parts.find(p => p.lang)?.lang ?? this.sourceLang;
      const sep = isCjk(lang) ? '' : ' ';
      const trs = parts.map(p => p.translation).filter(Boolean);
      const tlang = parts.find(p => p.tlang)?.tlang ?? this.targetLang;
      const tsep = isCjk(tlang) ? '' : ' ';
      return [key, {
        text: parts.map(p => isCjk(lang) ? p.text.replace(/[。．]$/, '') : p.text).join(sep).replace(/\s+/g, ' '),
        final: parts.every(p => p.final), speaker: parts[0].speaker, lang, tlang,
        translation: trs.join(tsep), pending: parts.some(p => p.pending && !p.translation && !p.merged) || (last.final && !last.translation && last.pending),
        unsure: parts.some(p => p.unsure), err: last.err, ts: Math.max(...parts.map(p => p.ts ?? 0)), trTs: Math.max(...parts.map(p => p.trTs ?? 0)),
        merged: false, cont: last.cont,
      }];
    });
  }

  visible() {
    const all = this.groups();
    const list = all.filter(([, it]) => !(this.display === 'target' && (it.merged || !it.final))).slice(-this.maxLines);
    // Older captions stay at most OLD_TTL: the speaker has moved on, so the line before last shouldn't linger
    const now = Date.now();
    const out = list.filter(([, it], i) => i === list.length - 1 || !it.final || now - it.ts < OLD_TTL);
    // With 1-2 visible sentences, a new sentence can arrive before the previous translation, pushing that translation out before anyone sees it.
    // Rule: when translations are shown, keep the latest translated sentence until its translation has been visible for MIN_TR_MS
    if (this.display !== 'source' && !out.some(([, it]) => it.translation)) {
      const lastTr = all.filter(([, it]) => it.final && it.translation).pop();
      if (lastTr && now - lastTr[1].trTs < MIN_TR_MS && !out.some(([k]) => k === lastTr[0])) out.unshift(lastTr); // temporarily show one extra sentence (without pushing out the one being spoken)
    }
    return out;
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
    const boxEl = el('div', 'ls-box' + (vis.length ? '' : ' ls-empty'));
    // Reserve height: each sentence = one source line (+ one translation line), so the box keeps its size when new sentences arrive
    const perLine = this.display === 'both' ? 1.38 * 0.74 + 1.38 + 0.15 : 1.38;
    boxEl.style.setProperty('--ls-minh', vis.length ? `calc(${(perLine * this.maxLines).toFixed(2)}em + 12px)` : '0');
    vis.forEach(([, it], idx) => {
      const cls = 'ls-line' + (idx < vis.length - 1 ? ' ls-old' : '');
      const box = el('div', cls);
      // Speaker colors are only used on the A/B tag and the side bar; text stays white (multi-colored text is hard to read)
      const color = this.diarize && it.final && it.speaker != null ? SPEAKER_COLORS[it.speaker % SPEAKER_COLORS.length] : null;
      const tag = () => {
        if (!color || !this.showSpeaker) return null;
        const w = el('span', 'ls-who', String.fromCharCode(65 + (it.speaker % 26)));
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
        if (this.layout === 'dst-top') box.append(d, s); else box.append(s, d);
      } else if (this.display === 'both' && it.final && it.merged) {
        // first half translated together with the next sentence: shown as a small source line, the translation appears on the next one
        const s = this._span('ls-src', it.text, srcLang);
        const t = tag(); if (t) s.prepend(t);
        box.appendChild(s);
      } else {
        const showTr = this.display === 'target' && it.final && (tr || it.pending);
        const s = showTr
          ? this._span('ls-only' + (it.pending && !tr ? ' ls-pending' : ''), tr || '…', tr ? dstLang : null)
          : this._span('ls-only' + (it.final ? '' : ' ls-partial'), it.text, srcLang, !it.final);
        const t = tag(); if (t) s.prepend(t);
        box.appendChild(s);
      }
      if (it.err && !tr && this.display !== 'source') box.appendChild(el('span', 'ls-err', ' ⚠ ' + t('翻译失败')));
      boxEl.appendChild(box);
    });
    frag.appendChild(boxEl);
    this.wrap.replaceChildren(frag);
  }
}

/** Display options derived from settings (shared by the overlay and the web layer) */
export function viewOptions(s) {
  return { display: s.display, boxWidth: s.boxWidth, diarize: s.diarize, fontSize: s.fontSize, bgOpacity: s.bgOpacity, maxLines: s.maxLines, showSpeaker: s.showSpeaker,
    layout: s.layout, subtitlePunct: s.subtitlePunct, maxChars: s.maxChars, sourceLang: s.sourceLang === 'auto' ? null : s.sourceLang, targetLang: s.targetLang };
}

function el(tag, cls, text) { const d = document.createElement(tag); d.className = cls; if (text != null) d.textContent = text; return d; }
