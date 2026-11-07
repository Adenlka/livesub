import { t, translateDOM } from '../../../packages/core/src/i18n.js';
translateDOM(document.body);
import { renderSettingsForm, FORM_CSS, RESTART_KEYS } from '../../../packages/core/src/settings-form.js';
import { requiredModels, essentialModels, MODELS } from '../../../packages/core/src/config.js';
import { isModelCached, deleteCachedModels } from '../../../packages/core/src/model-store.js';
import { loadSettings, saveSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const style = document.createElement('style'); style.textContent = FORM_CSS; document.head.appendChild(style);

let state = await chrome.runtime.sendMessage({ type: 'getState' });
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let settings = await loadSettings();

function setStatus(text, cls = '', progress = null) {
  const el = $('status');
  el.className = 'status ' + cls;
  el.textContent = t(text);
  if (progress != null && progress < 1) {
    const bar = document.createElement('div'); bar.className = 'progress';
    bar.innerHTML = `<i style="width:${(progress * 100).toFixed(1)}%"></i>`;
    el.appendChild(bar);
  }
}
function renderState() {
  const onHere = state.running && state.tabId === tab?.id;
  $('toggle').textContent = t(state.running ? (onHere ? '停止字幕' : '停止（正在其他标签页运行）') : '为当前标签页开启字幕');
  $('toggle').classList.toggle('on', state.running);
  if (!state.running) setStatus(state.statusState === 'error' ? state.status : '未开始', state.statusState === 'error' ? 'error' : '');
  else if (state.status) setStatus(state.status, state.statusState);
}

async function refreshCacheInfo() {
  const need = requiredModels(settings);
  const all = Object.keys(MODELS);
  const cached = Object.fromEntries(await Promise.all(all.map(async id => [id, await isModelCached(id)])));
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = t('本扩展共占用 {mb} MB。', { mb: (e.usage / 1e6).toFixed(0) }); } catch {}
  $('cacheInfo').textContent = all.map(id => `${t(MODELS[id].name)}: ${t(cached[id] ? '已下载' : '未下载')}${need.includes(id) ? t('（当前设置需要）') : ''}`).join(' / ') + ' · ' + usage;
  const missing = essentialModels(settings).filter(id => !cached[id]);
  const mb = missing.reduce((a, id) => a + MODELS[id].size, 0) / 1e6;
  $('firstRun').textContent = t('首次使用需要下载约 {mb}MB 模型（自动在后台完成，之后缓存在本机）。各语言的精识别模型会在第一次听到该语言时再下载。', { mb: mb.toFixed(0) });
  $('firstRun').classList.toggle('hide', !(missing.length && !state.running));
}

$('toggle').onclick = async () => {
  $('toggle').disabled = true;
  try {
    if (state.running) await chrome.runtime.sendMessage({ type: 'stop' });
    else {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      const r = await chrome.runtime.sendMessage({ type: 'start', tabId: tab.id, streamId });
      if (!r?.ok) setStatus(r?.error ?? '启动失败', 'error');
    }
  } catch (e) {
    setStatus(/Cannot capture|chrome:\/\/|Extension has not been invoked/.test(e.message) ? '这个页面不能采集声音（浏览器内部页面）。请在普通网页上使用。' : e.message, 'error');
  }
  state = await chrome.runtime.sendMessage({ type: 'getState' });
  if (state.running || !$('status').classList.contains('error')) renderState();
  $('restart').classList.add('hide');
  $('toggle').disabled = false;
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') {
    state.status = msg.message; state.statusState = msg.state;
    setStatus(msg.message, msg.state, msg.state === 'loading' ? msg.progress : null);
    if (msg.state === 'ready') refreshCacheInfo();
  } else if (msg.type === 'level') {
    const i = $('level');
    i.style.width = Math.min(100, Math.sqrt(msg.rms) * 260) + '%';
    i.classList.toggle('voiced', msg.voiced);
  }
});

$('panel').onclick = async () => {
  try { await chrome.sidePanel.open({ windowId: tab.windowId }); window.close(); }
  catch { chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') }); }
};
$('resetSpk').onclick = () => chrome.runtime.sendMessage({ target: 'offscreen', type: 'resetSpeakers' }).catch(() => {});
$('unload').onclick = async () => {
  if (state.running) { setStatus('先停止字幕再释放', 'warn'); return; }
  await chrome.runtime.sendMessage({ type: 'unloadModel' });
  setStatus('已释放内存', 'ready');
};
$('clearCache').onclick = async () => {
  if (state.running) { setStatus('先停止字幕再删除模型', 'warn'); return; }
  if (!confirm(t('删除已下载的识别模型？下次使用会重新下载。'))) return;
  await chrome.runtime.sendMessage({ type: 'unloadModel' });
  await deleteCachedModels();
  refreshCacheInfo();
  setStatus('已删除下载的模型', 'ready');
};

renderSettingsForm($('form'), settings, async (s, key) => {
  settings = s;
  await saveSettings(s);
  chrome.runtime.sendMessage({ type: 'settings', settings: s });
  if (state.running && RESTART_KEYS.has(key)) $('restart').classList.remove('hide');
  if (['engine', 'sourceLang', 'diarize', 'scene'].includes(key)) refreshCacheInfo();
});

renderState();
refreshCacheInfo();
