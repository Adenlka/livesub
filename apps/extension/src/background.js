import { t } from '../../../packages/core/src/i18n.js';
// Service worker: manages the offscreen document (where recognition runs), injects the subtitle layer into tabs, relays messages
import { loadSettings } from './settings.js';

const OFFSCREEN = 'offscreen.html';

async function getState() {
  const { state } = await chrome.storage.session.get('state');
  return state ?? { tabId: null, running: false, status: '', statusState: '' };
}
async function setState(patch) {
  const s = { ...(await getState()), ...patch };
  await chrome.storage.session.set({ state: s });
  chrome.action.setBadgeText({ text: s.running ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
  return s;
}

async function hasOffscreen() {
  return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
}
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({ url: OFFSCREEN, reasons: ['USER_MEDIA', 'WORKERS'], justification: 'Capture tab audio and run speech recognition locally' });
}
const toOffscreen = (m) => chrome.runtime.sendMessage({ target: 'offscreen', ...m });

async function injectOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const settings = await loadSettings();
    await chrome.tabs.sendMessage(tabId, { type: 'settings', settings }).catch(() => {});
  } catch {
    throw new Error(t('Subtitles can\'t be shown on this page (browser internal page or extension store). Try a normal web page.'));
  }
}

async function start(tabId, streamId) {
  const st = await getState();
  if (st.running) await stop({ keepModel: true });
  await injectOverlay(tabId);
  await ensureOffscreen();
  const settings = await loadSettings();
  // Tab title (video/stream name): streamer and game names become recognition hotwords and LLM translation context
  settings.pageTitle = await chrome.tabs.get(tabId).then(t => t.title ?? '').catch(() => '');
  await setState({ tabId, running: true, status: t('Starting…'), statusState: 'loading' });
  const r = await toOffscreen({ type: 'start', streamId, settings });
  if (r && r.ok === false) throw new Error(r.error);
}

async function stop({ keepModel = true } = {}) {
  const st = await getState();
  if (await hasOffscreen()) {
    await toOffscreen({ type: 'stop' }).catch(() => {});
    if (!keepModel) await chrome.offscreen.closeDocument().catch(() => {});
  }
  if (st.tabId != null) chrome.tabs.sendMessage(st.tabId, { type: 'stopped' }).catch(() => {});
  await setState({ running: false, status: '', statusState: '' });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return false;
  (async () => {
    const st = await getState();
    switch (msg.type) {
      case 'start':
        try { await start(msg.tabId, msg.streamId); sendResponse({ ok: true }); }
        catch (e) { await setState({ running: false }); sendResponse({ ok: false, error: e.message }); }
        return;
      case 'stop': await stop({ keepModel: msg.keepModel !== false }); sendResponse({ ok: true }); return;
      case 'getState': sendResponse({ ...st, offscreen: await hasOffscreen() }); return;
      case 'settings':
        if (st.tabId != null) chrome.tabs.sendMessage(st.tabId, { type: 'settings', settings: msg.settings }).catch(() => {});
        if (await hasOffscreen()) toOffscreen({ type: 'settings', settings: msg.settings }).catch(() => {});
        sendResponse({ ok: true }); return;
      case 'unloadModel':
        if (!st.running && await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
        sendResponse({ ok: true }); return;
      // offscreen -> tab
      case 'caption':
        if (st.tabId != null) chrome.tabs.sendMessage(st.tabId, msg).catch(() => {});
        sendResponse?.(); return;
      case 'status':
        await setState({ status: msg.message, statusState: msg.state });
        if (st.tabId != null) chrome.tabs.sendMessage(st.tabId, msg).catch(() => {});
        if (msg.state === 'stopped') await stop();
        sendResponse?.(); return;
      default: sendResponse?.();
    }
  })();
  return true;
});

// Re-inject the subtitle layer after a page reload (the audio stream itself is unaffected)
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  const st = await getState();
  if (st.running && st.tabId === tabId && info.status === 'complete') injectOverlay(tabId).catch(() => {});
  // Single-page apps like YouTube change the title when switching videos: update hotwords and translation context
  if (st.running && st.tabId === tabId && info.title) {
    const settings = await loadSettings();
    toOffscreen({ type: 'settings', settings: { ...settings, pageTitle: info.title } }).catch(() => {});
  }
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const st = await getState();
  if (st.tabId === tabId && st.running) stop();
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== 'toggle-captions') return;
  const st = await getState();
  if (st.running) return stop();
  const t = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!t) return;
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: t.id });
    await start(t.id, streamId);
  } catch (e) { await setState({ running: false, status: e.message, statusState: 'error' }); }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
});
