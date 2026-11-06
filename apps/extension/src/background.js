// Service worker: manages the offscreen document (runs recognition), injects the caption layer into the target tab, relays messages
import { loadSettings } from './settings.js';

const OFFSCREEN = 'offscreen.html';

async function getState() {
  const { state } = await chrome.storage.session.get('state');
  return state ?? { tabId: null, running: false, status: '' };
}
async function setState(patch) {
  const s = { ...(await getState()), ...patch };
  await chrome.storage.session.set({ state: s });
  chrome.action.setBadgeText({ text: s.running ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#d33' });
  return s;
}

async function hasOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return ctx.length > 0;
}
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ['USER_MEDIA', 'WORKERS'],
    justification: '采集标签页音频并在本地运行语音识别模型',
  });
}

async function injectOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const settings = await loadSettings();
    await chrome.tabs.sendMessage(tabId, { type: 'settings', settings }).catch(() => {});
  } catch (e) {
    console.warn('注入失败', e);
    throw new Error('这个页面不能显示字幕（浏览器内部页面或扩展商店页面）');
  }
}

async function start(tabId, streamId) {
  const st = await getState();
  if (st.running) await stop();
  await injectOverlay(tabId);
  await ensureOffscreen();
  const settings = await loadSettings();
  await setState({ tabId, running: true, status: '启动中…' });
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, settings });
}

async function stop() {
  const st = await getState();
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
    await chrome.offscreen.closeDocument().catch(() => {});
  }
  if (st.tabId != null) chrome.tabs.sendMessage(st.tabId, { type: 'clear' }).catch(() => {});
  await setState({ running: false, status: '' });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return; // Meant for offscreen, ignore
  (async () => {
    const st = await getState();
    switch (msg.type) {
      case 'start':
        try { await start(msg.tabId, msg.streamId); sendResponse({ ok: true }); }
        catch (e) { await setState({ running: false }); sendResponse({ ok: false, error: e.message }); }
        return;
      case 'stop':
        await stop(); sendResponse({ ok: true }); return;
      case 'getState':
        sendResponse(st); return;
      case 'settings':
        if (st.tabId != null) chrome.tabs.sendMessage(st.tabId, { type: 'settings', settings: msg.settings }).catch(() => {});
        if (st.running) chrome.runtime.sendMessage({ target: 'offscreen', type: 'settings', settings: msg.settings }).catch(() => {});
        sendResponse({ ok: true }); return;
      // Events from offscreen -> forward to the tab
      case 'caption':
        if (st.tabId != null) chrome.tabs.sendMessage(st.tabId, msg).catch(() => {});
        return;
      case 'status':
        await setState({ status: msg.message });
        if (st.tabId != null) chrome.tabs.sendMessage(st.tabId, msg).catch(() => {});
        if (msg.state === 'stopped') await stop();
        return;
    }
  })();
  return true;
});

// Re-inject the subtitle layer after a page reload (the audio stream itself is unaffected)
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  const st = await getState();
  if (st.running && st.tabId === tabId && info.status === 'complete') injectOverlay(tabId).catch(() => {});
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const st = await getState();
  if (st.tabId === tabId) stop();
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== 'toggle-captions') return;
  const st = await getState();
  if (st.running) return stop();
  const t = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!t) return;
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: t.id });
  start(t.id, streamId).catch(e => console.warn(e));
});
