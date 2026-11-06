// Desktop control panel: capture system audio/microphone -> caption pipeline -> overlay window
import { CaptionPipeline, speakerName } from '../../../../packages/core/src/pipeline.js';
import { renderSettingsForm, FORM_CSS, RESTART_KEYS } from '../../../../packages/core/src/settings-form.js';
import { DEFAULT_SETTINGS } from '../../../../packages/core/src/languages.js';
import { SPEAKER_COLORS } from '../../../../packages/core/src/speaker.js';

const $ = (id) => document.getElementById(id);
const api = window.livesub;
const css = document.createElement('style'); css.textContent = FORM_CSS; document.head.appendChild(css);

// --- settings ---
function load() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('settings') ?? '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
let settings = load();
const save = () => { try { localStorage.setItem('settings', JSON.stringify(settings)); } catch {} };
let needRestart = false;

renderSettingsForm($('form'), settings, (s, key) => {
  settings = s; save();
  api.setOverlaySettings(s);
  pipe?.updateSettings(s);
  if (RESTART_KEYS.has(key)) { needRestart = true; if (running) $('restart').classList.remove('hide'); }
});
api.setOverlaySettings(settings);

// --- audio source ---
async function listSources() {
  const sel = $('source');
  const cur = sel.value || localStorage.getItem('source') || 'system';
  let mics = [];
  try { mics = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch {}
  sel.innerHTML = `<option value="system">系统声音（电脑正在播放的一切）</option>` +
    mics.map((m, i) => `<option value="mic:${m.deviceId}">🎙 ${m.label || '麦克风 ' + (i + 1)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'system';
}
$('source').onchange = () => { localStorage.setItem('source', $('source').value); if (running) { stop(); start(); } };
navigator.mediaDevices.addEventListener?.('devicechange', listSources);
listSources();

// --- status display ---
function setStatus(text, cls = '', progress = null) {
  const el = $('status');
  el.className = 'status ' + cls; el.textContent = text;
  if (progress != null && progress < 1) {
    const bar = document.createElement('div'); bar.className = 'progress';
    bar.innerHTML = `<i style="width:${(progress * 100).toFixed(1)}%"></i>`; el.appendChild(bar);
  }
}

// --- transcript ---
const logItems = new Map();
function renderEmptyLog() { if (!logItems.size) $('log').innerHTML = '<div class="empty">开始后，字幕会记录在这里</div>'; }
renderEmptyLog();
function logCaption(c) {
  if (!c.final) return;
  const log = $('log');
  if (c.removed) { logItems.get(c.id)?.remove(); logItems.delete(c.id); return; }
  if (!logItems.size) log.innerHTML = '';
  let el = logItems.get(c.id);
  const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  if (!el) {
    el = document.createElement('div'); el.className = 'item';
    el.innerHTML = '<div class="meta"></div><div class="src"></div><div class="dst"></div>';
    log.appendChild(el); logItems.set(c.id, el);
  }
  const color = c.speaker != null ? SPEAKER_COLORS[c.speaker % SPEAKER_COLORS.length] : null;
  el.style.borderLeftColor = color ?? '';
  el.querySelector('.meta').textContent = new Date().toLocaleTimeString() + (c.speaker != null ? ' · ' + speakerName(c.speaker) : '');
  el.querySelector('.src').textContent = c.text;
  if (color) el.querySelector('.src').style.color = color;
  if (c.translation !== undefined) el.querySelector('.dst').textContent = c.translation;
  if (stick) log.scrollTop = log.scrollHeight;
}

// --- capture and pipeline ---
let running = false, stream = null, ctx = null, pipe = null, lastLevel = 0;

const ipcFetch = async (url, init = {}) => {
  const r = await api.fetch(url, { method: init.method, headers: init.headers, body: init.body });
  if (r.error) throw new Error(r.error);
  return { ok: r.ok, status: r.status, text: async () => r.text, json: async () => JSON.parse(r.text) };
};

function makePipeline() {
  pipe?.dispose();
  const worker = new Worker('asr-worker.js', { type: 'module' });
  pipe = new CaptionPipeline({
    worker, assetBase: location.origin + '/', settings, fetch: ipcFetch,
    onCaption: (c) => { api.sendCaption(c); logCaption(c); },
    onStatus: (s) => {
      api.sendStatus(s);
      setStatus(s.message, s.state === 'error' ? 'error' : s.state === 'ready' ? 'ready' : '', s.state === 'loading' ? s.progress : null);
    },
    onLevel: (rms, voiced) => {
      const now = performance.now();
      if (now - lastLevel < 120) return;
      lastLevel = now;
      $('level').style.width = Math.min(100, Math.sqrt(rms) * 260) + '%';
      $('level').classList.toggle('voiced', voiced);
    },
  });
  pipe.start();
  needRestart = false;
}

async function start() {
  if (running) return;
  $('toggle').disabled = true;
  try {
    const src = $('source').value;
    if (src === 'system') {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach(t => { t.stop(); stream.removeTrack(t); });
      if (!stream.getAudioTracks().length) throw new Error('没有拿到系统声音');
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: src.slice(4) }, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
      listSources(); // device names are only available after permission is granted
    }
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule('capture-worklet.js');
    const node = new AudioWorkletNode(ctx, 'ls-capture');
    ctx.createMediaStreamSource(stream).connect(node); // Don't connect to the speakers: system audio is already playing
    if (!pipe || needRestart) makePipeline();
    else setStatus('识别中', 'ready');
    node.port.onmessage = (e) => pipe.pushAudio(e.data, ctx.sampleRate);
    running = true;
    $('toggle').textContent = '停止字幕';
    $('toggle').classList.add('on');
  } catch (e) {
    setStatus('启动失败：' + e.message, 'error');
    await cleanup();
  } finally { $('toggle').disabled = false; }
}

async function cleanup() {
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  await ctx?.close().catch(() => {}); ctx = null;
}

async function stop() {
  if (!running) return;
  running = false;
  pipe?.stop();
  await cleanup();
  $('toggle').textContent = '开始字幕';
  $('toggle').classList.remove('on');
  $('restart').classList.add('hide');
  $('level').style.width = '0';
  setStatus('已停止（模型保持加载，再次开始无需等待）');
  setTimeout(() => api.clearOverlay(), 3000);
}

$('toggle').onclick = () => (running ? stop() : start());
api.onToggle(() => (running ? stop() : start()));

// --- other buttons ---
let locked = await api.getOverlayLocked();
const renderLock = () => ($('lock').textContent = locked ? '解锁字幕位置' : '锁定字幕位置');
$('lock').onclick = () => api.setOverlayLocked(!locked);
api.onOverlayLock((v) => { locked = v; renderLock(); });
renderLock();

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
async function exportAs(kind) {
  const content = kind === 'srt' ? pipe?.exportSRT() : pipe?.exportText();
  if (!content) { setStatus('还没有字幕内容', 'error'); return; }
  await api.saveFile(`livesub-${stamp()}.${kind}`, content);
}
$('exportTxt').onclick = () => exportAs('txt');
$('exportSrt').onclick = () => exportAs('srt');
$('resetSpk').onclick = () => pipe?.resetSpeakers();

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  $('log').classList.toggle('hide', b.dataset.tab !== 'log');
  $('settings').classList.toggle('hide', b.dataset.tab !== 'settings');
});
