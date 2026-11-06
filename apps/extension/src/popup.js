import { renderSettingsForm, FORM_CSS, RESTART_KEYS } from '../../../packages/core/src/settings-form.js';
import { loadSettings, saveSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const style = document.createElement('style'); style.textContent = FORM_CSS; document.head.appendChild(style);

let state = await chrome.runtime.sendMessage({ type: 'getState' });
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

function renderState() {
  const onHere = state.running && state.tabId === tab?.id;
  $('toggle').textContent = state.running ? (onHere ? '停止字幕' : '停止（字幕正在其他标签页运行）') : '为当前标签页开启字幕';
  $('toggle').classList.toggle('on', state.running);
  if (!state.running) setStatus('未开始');
  else if (state.status) setStatus(state.status);
}
function setStatus(text, cls = '', progress = null) {
  const el = $('status');
  el.className = 'status ' + cls;
  el.textContent = text;
  if (progress != null && progress < 1) {
    const bar = document.createElement('div'); bar.className = 'progress';
    bar.innerHTML = `<i style="width:${(progress * 100).toFixed(1)}%"></i>`;
    el.appendChild(bar);
  }
}

$('toggle').onclick = async () => {
  $('toggle').disabled = true;
  try {
    if (state.running) {
      await chrome.runtime.sendMessage({ type: 'stop' });
    } else {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      const r = await chrome.runtime.sendMessage({ type: 'start', tabId: tab.id, streamId });
      if (!r?.ok) setStatus(r?.error ?? '启动失败', 'error');
    }
  } catch (e) {
    setStatus(e.message.includes('Cannot capture') ? '这个页面不能采集音频（浏览器内部页面）' : e.message, 'error');
  }
  state = await chrome.runtime.sendMessage({ type: 'getState' });
  if (state.running || !$('status').classList.contains('error')) renderState();
  $('toggle').disabled = false;
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') {
    state.status = msg.message;
    setStatus(msg.message, msg.state === 'error' ? 'error' : msg.state === 'ready' ? 'ready' : '', msg.state === 'loading' ? msg.progress : null);
  } else if (msg.type === 'level') {
    const i = $('level');
    i.style.width = Math.min(100, Math.sqrt(msg.rms) * 260) + '%';
    i.classList.toggle('voiced', msg.voiced);
  }
});

async function download(kind) {
  if (!state.running) { setStatus('字幕运行中才能导出（停止后记录会清空）', 'error'); return; }
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'export' });
  const content = kind === 'srt' ? r?.srt : r?.text;
  if (!content) { setStatus('还没有字幕内容', 'error'); return; }
  const url = URL.createObjectURL(new Blob(['﻿' + content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `livesub-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${kind}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$('exportTxt').onclick = () => download('txt');
$('exportSrt').onclick = () => download('srt');
$('resetSpk').onclick = () => chrome.runtime.sendMessage({ target: 'offscreen', type: 'resetSpeakers' }).catch(() => {});

renderSettingsForm($('form'), await loadSettings(), async (s, key) => {
  await saveSettings(s);
  chrome.runtime.sendMessage({ type: 'settings', settings: s });
  if (state.running && RESTART_KEYS.has(key)) $('restart').classList.remove('hide');
});

renderState();
