// Subtitle renderer (shared by the desktop overlay and the web page layer)
import { SPEAKER_COLORS } from './speaker.js';
export const CAPTION_CSS = `
.ls-wrap{display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;
  font-family:"Noto Sans JP","Noto Sans SC","Microsoft YaHei UI","Yu Gothic UI","Meiryo",sans-serif;}
.ls-line{max-width:100%;padding:4px 14px;border-radius:8px;background:rgba(0,0,0,var(--ls-bg,.62));
  color:#fff;text-align:center;line-height:1.35;text-shadow:0 1px 2px #000;word-break:break-word;
  transition:opacity .25s;}
.ls-src{font-size:calc(var(--ls-font,28px) * .78);color:#e8e8e8}
.ls-dst{font-size:var(--ls-font,28px);font-weight:600}
.ls-only{font-size:var(--ls-font,28px);font-weight:600}
.ls-partial{color:#bfe3ff;font-style:normal;opacity:.9}
.ls-pending{opacity:.55}
.ls-old{opacity:.6}
.ls-tag{display:inline-block;width:.55em;height:.55em;border-radius:50%;margin-right:.4em;vertical-align:.12em}
.ls-status{font-size:13px;color:#ffd27a;background:rgba(0,0,0,.6);padding:2px 10px;border-radius:6px}
`;

export class CaptionView {
  constructor(root, opts = {}) {
    this.root = root;
    this.maxLines = opts.maxLines ?? 2;
    this.display = opts.display ?? 'both';
    this.items = new Map(); // id -> {text, translation, final}
    this.order = [];
    this.status = '';
    this.hideTimer = null;
    this.wrap = document.createElement('div');
    this.wrap.className = 'ls-wrap';
    root.appendChild(this.wrap);
  }

  setOptions({ display, fontSize, bgOpacity }) {
    if (display) this.display = display;
    if (fontSize) this.root.style.setProperty('--ls-font', fontSize + 'px');
    if (bgOpacity != null) this.root.style.setProperty('--ls-bg', bgOpacity);
    this.render();
  }

  setStatus(text) { this.status = text ?? ''; this.render(); }

  update(c) {
    if (c.removed) {
      this.items.delete(c.id);
      this.order = this.order.filter(i => i !== c.id);
    } else {
      const it = this.items.get(c.id) ?? {};
      it.text = c.text;
      if (c.translation !== undefined) it.translation = c.translation;
      it.final = c.final;
      if (c.speaker !== undefined) it.speaker = c.speaker;
      it.pending = !!c.pendingTranslation && c.translation === undefined;
      if (!this.items.has(c.id)) this.order.push(c.id);
      this.items.set(c.id, it);
      this.order.sort((a, b) => a - b);
      while (this.order.length > 8) this.items.delete(this.order.shift());
    }
    this.render();
    // Fade out old captions when nothing new arrives for a while
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { this.items.clear(); this.order = []; this.render(); }, 12000);
  }

  clear() { this.items.clear(); this.order = []; this.render(); }

  render() {
    const ids = this.order.slice(-this.maxLines);
    const frag = document.createDocumentFragment();
    if (this.status) {
      const s = document.createElement('div');
      s.className = 'ls-status'; s.textContent = this.status;
      frag.appendChild(s);
    }
    ids.forEach((id, idx) => {
      const it = this.items.get(id);
      const old = idx < ids.length - 1 ? ' ls-old' : '';
      const partial = it.final ? '' : ' ls-partial';
      if (this.display === 'source' || !it.final || (this.display === 'both' && !it.translation && !it.pending)) {
        if (this.display === 'target' && !it.final) return; // In translation-only mode, don't show the unfinished source text
        frag.appendChild(colorize(line('ls-line ls-only' + partial + old, it.text), it));
        return;
      }
      if (this.display === 'both') {
        const box = document.createElement('div');
        box.className = 'ls-line' + old;
        box.appendChild(span('ls-src', it.text));
        box.appendChild(document.createElement('br'));
        box.appendChild(span('ls-dst' + (it.pending ? ' ls-pending' : ''), it.translation || '…'));
        frag.appendChild(colorize(box, it));
      } else {
        frag.appendChild(colorize(line('ls-line ls-only' + old + (it.pending ? ' ls-pending' : ''), it.translation || it.text), it));
      }
    });
    this.wrap.replaceChildren(frag);
  }
}

function line(cls, text) { const d = document.createElement('div'); d.className = cls; d.textContent = text; return d; }
function span(cls, text) { const d = document.createElement('span'); d.className = cls; d.textContent = text; return d; }

function colorize(el, it) {
  if (it.speaker == null || !it.final) return el;
  const c = SPEAKER_COLORS[it.speaker % SPEAKER_COLORS.length];
  el.style.color = c;
  el.style.borderLeft = `4px solid ${c}`;
  el.querySelectorAll('.ls-src,.ls-dst').forEach(s => (s.style.color = c));
  const dot = document.createElement('span');
  dot.className = 'ls-tag'; dot.style.background = c;
  el.prepend(dot);
  return el;
}
