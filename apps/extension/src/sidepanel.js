// Side panel: full live transcript, search, export, AI summary
import { SPEAKER_COLORS, speakerName } from '../../../packages/core/src/speaker.js';

const $ = (id) => document.getElementById(id);
const items = new Map(); // key -> {el, rec}
const toOff = (m) => chrome.runtime.sendMessage({ target: 'offscreen', ...m });

function fmt(ms) { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

function upsert(key, rec) {
  const log = $('log');
  if (!items.size) log.innerHTML = '';
  let it = items.get(key);
  const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  if (!it) {
    const el = document.createElement('div'); el.className = 'item';
    el.innerHTML = '<div class="meta"></div><div class="src"></div><div class="dst"></div>';
    // insert in key order
    const after = [...items.keys()].filter(k => k > key).sort((a, b) => a - b)[0];
    if (after != null) log.insertBefore(el, items.get(after).el); else log.appendChild(el);
    it = { el, rec: {} }; items.set(key, it);
  }
  Object.assign(it.rec, rec);
  const r = it.rec;
  const color = r.speaker != null ? SPEAKER_COLORS[r.speaker % SPEAKER_COLORS.length] : '';
  it.el.style.borderLeftColor = color;
  it.el.querySelector('.meta').textContent = (r.t != null ? fmt(r.t) : '') + (r.speaker != null ? ' · ' + speakerName(r.speaker) : '');
  const src = it.el.querySelector('.src'); src.textContent = r.text ?? ''; src.style.color = color; src.classList.toggle('low', r.conf != null && r.conf < 0.6);
  it.el.querySelector('.dst').textContent = r.merged ? '' : (r.translation ?? '');
  applyFilter(it);
  if (stick) log.scrollTop = log.scrollHeight;
}

function applyFilter(it) {
  const q = $('q').value.trim();
  it.el.classList.toggle('hide', !!q && !((it.rec.text ?? '') + (it.rec.translation ?? '')).includes(q));
}
$('q').oninput = () => items.forEach(applyFilter);

chrome.runtime.onMessage.addListener((m) => {
  if (m.type === 'caption') {
    if (m.removed) { items.get(m.key)?.el.remove(); items.delete(m.key); return; }
    if (m.final) upsert(m.key, { text: m.text, speaker: m.speaker, conf: m.conf, ...(m.translation !== undefined ? { translation: m.translation } : {}), merged: m.merged });
  } else if (m.type === 'status') $('state').textContent = m.state === 'ready' ? '运行中' : m.message;
});

async function load() {
  const r = await toOff({ type: 'getTranscript' }).catch(() => null);
  if (!r?.rows?.length) return;
  r.rows.filter(row => row.text).forEach((row) => upsert(row.key, row));
  $('state').textContent = r.running ? '运行中' : '已停止';
}

async function exportAs(kind) {
  const r = await toOff({ type: 'export' }).catch(() => null);
  const content = r?.[kind];
  if (!content) { $('state').textContent = '还没有字幕内容'; return; }
  const url = URL.createObjectURL(new Blob([kind === 'vtt' ? content : '﻿' + content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  a.href = url; a.download = `livesub-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.${kind}`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
document.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => exportAs(b.dataset.exp));
$('copy').onclick = async () => { const r = await toOff({ type: 'export' }).catch(() => null); if (r?.txt) { await navigator.clipboard.writeText(r.txt); $('state').textContent = '已复制'; } };
$('clear').onclick = async () => { if (!confirm('清空字幕记录？')) return; await toOff({ type: 'clearTranscript' }).catch(() => {}); items.clear(); $('log').innerHTML = '<div class="empty">已清空</div>'; };
$('sum').onclick = async () => {
  const box = $('summary'); box.classList.remove('hide'); box.textContent = '正在总结…';
  const r = await toOff({ type: 'summarize' }).catch(e => ({ error: e.message }));
  box.textContent = r?.error ? '⚠ ' + r.error : r?.text || '（没有内容）';
};
load();
