// Desktop control panel: capture (system audio / microphone / both / video file) -> subtitle pipeline -> overlay + transcript
import { CaptionPipeline } from '../../../../packages/core/src/pipeline.js';
import { renderSettingsForm, FORM_CSS, RESTART_KEYS } from '../../../../packages/core/src/settings-form.js';
import { DEFAULT_SETTINGS, MODELS, modelUrls, requiredModels } from '../../../../packages/core/src/config.js';
import { SPEAKER_COLORS, speakerName } from '../../../../packages/core/src/speaker.js';

const $ = (id) => document.getElementById(id);
const api = window.livesub;
const css = document.createElement('style'); css.textContent = FORM_CSS; document.head.appendChild(css);

// --- settings ---
function load() {
  try { const s = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('settings') ?? '{}') }; delete s.model; return s; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
let settings = load();
const save = () => { try { localStorage.setItem('settings', JSON.stringify(settings)); } catch {} };
$('autoSave').checked = settings.autoSave;
$('autoSave').onchange = () => { settings.autoSave = $('autoSave').checked; save(); };

renderSettingsForm($('form'), settings, (s, key) => {
  settings = { ...s, autoSave: settings.autoSave }; save();
  api.setOverlaySettings(settings);
  if (pipe) {
    const { needsRestart } = pipe.updateSettings(settings);
    if (needsRestart) { pipeStale = true; if (running) $('restart').classList.remove('hide'); }
  }
});
api.setOverlaySettings(settings);

// --- audio source ---
async function listSources() {
  const sel = $('source');
  const cur = sel.value || localStorage.getItem('source') || 'system';
  let mics = [];
  try { mics = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications'); } catch {}
  sel.innerHTML = `<option value="system">系统声音（电脑正在播放的一切）</option><option value="mix">系统声音 + 麦克风（线上会议）</option>` +
    mics.map((m, i) => `<option value="mic:${m.deviceId}">🎙 ${m.label || '麦克风 ' + (i + 1)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'system';
  $('srcHint').classList.toggle('hide', sel.value !== 'mix');
}
$('source').onchange = async () => {
  localStorage.setItem('source', $('source').value);
  $('srcHint').classList.toggle('hide', $('source').value !== 'mix');
  if (running) { await stop(); start(); }
};
navigator.mediaDevices.addEventListener?.('devicechange', listSources);
listSources();

// --- status ---
function setStatus(text, cls = '', progress = null) {
  const el = $('status');
  el.className = 'status ' + cls; el.textContent = text;
  if (progress != null && progress < 1) {
    const bar = document.createElement('div'); bar.className = 'progress';
    bar.innerHTML = `<i style="width:${(progress * 100).toFixed(1)}%"></i>`; el.appendChild(bar);
  }
}

// --- transcript (panel + autosave) ---
const logItems = new Map();
const fmtT = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function renderEmptyLog() { if (!logItems.size) $('logList').innerHTML = '<div class="empty">开始后，字幕会记录在这里</div>'; }
function logCaption(c) {
  const list = $('logList');
  if (c.removed) { logItems.get(c.key)?.el.remove(); logItems.delete(c.key); renderEmptyLog(); return; }
  if (!c.final) return;
  if (!logItems.size) list.innerHTML = '';
  let it = logItems.get(c.key);
  const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
  if (!it) {
    const el = document.createElement('div'); el.className = 'item';
    el.innerHTML = '<div class="meta"></div><div class="src"></div><div class="dst"></div>';
    const after = [...logItems.keys()].filter(k => k > c.key).sort((a, b) => a - b)[0];
    if (after != null) list.insertBefore(el, logItems.get(after).el); else list.appendChild(el);
    it = { el, rec: {} }; logItems.set(c.key, it);
  }
  for (const k of ['text', 'speaker', 'conf', 'translation', 'merged']) if (c[k] !== undefined) it.rec[k] = c[k];
  const r = it.rec, rec = pipe?.transcript.get(c.key);
  const color = r.speaker != null ? SPEAKER_COLORS[r.speaker % SPEAKER_COLORS.length] : '';
  it.el.style.borderLeftColor = color;
  it.el.querySelector('.meta').textContent = (rec ? fmtT(rec.t) : '') + (r.speaker != null ? ' · ' + speakerName(r.speaker) : '');
  const src = it.el.querySelector('.src'); src.textContent = r.text ?? ''; src.style.color = color; src.classList.toggle('low', r.conf != null && r.conf < 0.6);
  it.el.querySelector('.dst').textContent = r.merged ? '' : (r.translation ?? '');
  filterItem(it);
  if (stick) list.scrollTop = list.scrollHeight;
  autosave(c, r, rec);
}
function filterItem(it) {
  const q = $('q').value.trim();
  it.el.classList.toggle('hide', !!q && !((it.rec.text ?? '') + (it.rec.translation ?? '')).includes(q));
}
$('q').oninput = () => logItems.forEach(filterItem);

// Autosave: wait for the translation before writing (write immediately when translation is off)
const saved = new Set();
function autosave(c, r, rec) {
  if (!settings.autoSave || mode !== 'live' || saved.has(c.key) || !r.text) return;
  const ready = !pipe?.tm.enabled || c.translation !== undefined || c.merged;
  if (!ready) return;
  saved.add(c.key);
  const who = r.speaker != null ? speakerName(r.speaker) + '：' : '';
  api.autosaveAppend(`[${rec ? fmtT(rec.t) : ''}] ${who}${r.text}${r.translation && !r.merged ? '\n    → ' + r.translation : ''}`);
}

// --- pipeline ---
let pipe = null, pipeStale = false, running = false, mode = 'idle'; // idle | live | file
let stream = null, extraStreams = [], ctx = null, lastLevel = 0;

const ipcFetch = async (url, init = {}) => {
  const r = await api.fetch(url, { method: init.method, headers: init.headers, body: init.body });
  if (r.error) throw new Error(r.error);
  return { ok: r.ok, status: r.status, text: async () => r.text, json: async () => JSON.parse(r.text) };
};

api.onModelProgress((p) => setStatus(`下载${p.label} ${(p.loaded / 1e6).toFixed(0)} / ${(p.total / 1e6).toFixed(0)} MB`, '', p.total ? p.loaded / p.total : 0));

/** Make sure the required models are on disk (downloaded by the main process, with progress) */
async function ensureModels() {
  const ids = requiredModels(settings);
  if (!ids.length) return true;
  setStatus('检查识别模型…');
  const specs = ids.map(id => ({ id, name: MODELS[id].name, size: MODELS[id].size, files: MODELS[id].files,
    urls: Object.fromEntries(MODELS[id].files.map(f => [f, modelUrls(id, f, settings.modelHost)])) }));
  const r = await api.ensureModels(specs);
  if (!r.ok) { setStatus('模型下载失败：' + r.error + '。可以在「设置 → 高级 → 模型下载源」换成镜像再试。', 'error'); return false; }
  refreshModelInfo();
  return true;
}

async function getPipeline() {
  if (pipe && !pipeStale) return pipe;
  pipe?.dispose(); pipe = null;
  if (!(await ensureModels())) return null;
  pipe = new CaptionPipeline({
    createWorker: (n) => new Worker(n === 'vad' ? 'vad-worker.js' : 'asr-worker.js', { type: 'module' }),
    assetBase: location.origin + '/', localModelBase: location.origin + '/models/',
    settings, fetch: ipcFetch, realtime: true,
    onCaption: (c) => { if (mode === 'live') api.sendCaption(c); logCaption(c); },
    onStatus: (s) => {
      if (mode === 'live' || s.state === 'error') api.sendStatus(s);
      if (mode === 'file' && s.state === 'ready') return;
      setStatus(s.message, s.state, s.state === 'loading' ? s.progress : null);
    },
    onLevel: (rms, voiced) => {
      const now = performance.now();
      if (now - lastLevel < 100) return;
      lastLevel = now;
      $('level').style.width = Math.min(100, Math.sqrt(rms) * 260) + '%';
      $('level').classList.toggle('voiced', voiced);
    },
  });
  pipeStale = false;
  pipe.start();
  return pipe;
}

async function openStreams(src) {
  const sys = async () => {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    s.getVideoTracks().forEach(t => { t.stop(); s.removeTrack(t); });
    if (!s.getAudioTracks().length) throw new Error('没有拿到系统声音');
    return s;
  };
  const mic = (deviceId) => navigator.mediaDevices.getUserMedia({
    audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  if (src === 'system') return [await sys()];
  if (src === 'mix') return [await sys(), await mic()];
  return [await mic(src.slice(4))];
}

async function start() {
  if (running) return;
  if (mode === 'file') { setStatus('正在转写文件，请等它完成', 'warn'); return; }
  $('toggle').disabled = true;
  try {
    const p = await getPipeline();
    if (!p) return;
    const streams = await openStreams($('source').value);
    if ($('source').value !== 'system') listSources(); // device names are only available after permission is granted
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule('capture-worklet.js');
    const node = new AudioWorkletNode(ctx, 'ls-capture');
    // Connecting several sources to one node = mixing; not routed to the speakers (system audio is already playing)
    for (const s of streams) ctx.createMediaStreamSource(s).connect(node);
    stream = streams[0]; extraStreams = streams.slice(1);
    node.port.onmessage = (e) => { if (running) p.pushAudio(e.data, ctx.sampleRate); };
    running = true; mode = 'live';
    if (p.ready) setStatus('识别中', 'ready');
    if (settings.autoSave) api.autosaveBegin(settings.scene && settings.scene !== 'custom' ? settings.scene : '');
    saved.clear();
    $('toggle').textContent = '停止字幕';
    $('toggle').classList.add('on');
  } catch (e) {
    setStatus('启动失败：' + (e.name === 'NotAllowedError' ? '没有获得录音权限' : e.message), 'error');
    await closeStreams();
  } finally { $('toggle').disabled = false; }
}

async function closeStreams() {
  [stream, ...extraStreams].forEach(s => s?.getTracks().forEach(t => t.stop()));
  stream = null; extraStreams = [];
  await ctx?.close().catch(() => {}); ctx = null;
}

async function stop() {
  if (!running) return;
  running = false;
  await closeStreams();
  $('toggle').textContent = '开始字幕';
  $('toggle').classList.remove('on');
  $('restart').classList.add('hide');
  $('level').style.width = '0';
  setStatus('正在收尾…');
  await pipe?.stop().catch(() => {});
  mode = 'idle';
  setStatus('已停止（模型保持加载，再次开始无需等待）');
  setTimeout(() => { if (!running) api.clearOverlay(); }, 3000);
}

$('toggle').onclick = () => (running ? stop() : start());
api.onToggle(() => (running ? stop() : start()));

// --- video/audio file to subtitles ---
$('file').onclick = () => { if (running) { setStatus('先停止实时字幕再转写文件', 'warn'); return; } $('fileInput').click(); };
$('fileInput').onchange = async () => {
  const f = $('fileInput').files[0];
  $('fileInput').value = '';
  if (!f) return;
  if (f.size > 2.5e9) { setStatus('文件太大（超过 2.5GB），请先剪短或只导出音轨', 'error'); return; }
  mode = 'file';
  $('toggle').disabled = true; $('file').disabled = true;
  try {
    const p = await getPipeline();
    if (!p) return;
    setStatus(`读取并解码「${f.name}」…`);
    // Decode straight to 16 kHz (saves memory)
    const buf = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await f.arrayBuffer());
    const ch = buf.numberOfChannels > 1 ? [buf.getChannelData(0), buf.getChannelData(1)] : [buf.getChannelData(0)];
    await new Promise((res) => { const iv = setInterval(() => { if (p.ready) { clearInterval(iv); res(); } }, 200); });
    p.transcript.clear(); logItems.clear(); renderEmptyLog();
    p.resetSpeakers(); // speakers in the file are numbered from A
    p.realtime = false;
    await p.resetTimeline();
    const total = ch[0].length, step = 16000 * 10;
    for (let i = 0; i < total; i += step) {
      p.pushAudio(ch.map(c => c.slice(i, i + step)), 16000);
      // Backpressure: pause briefly when recognition falls behind (and update progress)
      while (p.outstanding > 3) await new Promise(r => setTimeout(r, 200));
      setStatus(`转写中 ${fmtT(i / 16)} / ${fmtT(total / 16)}`, '', i / total);
    }
    await p.stop();
    p.realtime = true;
    setStatus(`转写完成：${p.rows().length} 条字幕`, 'ready');
    const name = f.name.replace(/\.[^.]+$/, '');
    const out = await api.saveFile(name + '.srt', p.exportSRT());
    if (out) setStatus(`已保存 ${out}`, 'ready');
  } catch (e) {
    setStatus('转写失败：' + (/decode|Unable to decode/i.test(e.message) ? '无法解码这个文件的音频（格式不支持）' : e.message), 'error');
  } finally {
    if (pipe) pipe.realtime = true;
    mode = 'idle';
    $('toggle').disabled = false; $('file').disabled = false;
  }
};

// --- other buttons ---
let locked = await api.getOverlayLocked();
const renderLock = () => ($('lock').textContent = locked ? '解锁字幕位置' : '锁定字幕位置');
$('lock').onclick = () => api.setOverlayLocked(!locked);
api.onOverlayLock((v) => { locked = v; renderLock(); });
renderLock();
$('folder').onclick = () => api.openTranscripts();

const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
document.querySelectorAll('[data-exp]').forEach(b => b.onclick = async () => {
  const kind = b.dataset.exp;
  const content = kind === 'srt' ? pipe?.exportSRT() : kind === 'vtt' ? pipe?.exportVTT() : pipe?.exportText();
  if (!content || content === 'WEBVTT\n\n') { setStatus('还没有字幕内容', 'warn'); return; }
  const out = await api.saveFile(`livesub-${stamp()}.${kind}`, content);
  if (out) setStatus('已保存 ' + out, 'ready');
});
$('copy').onclick = async () => { const t = pipe?.exportText(); if (t) { await navigator.clipboard.writeText(t); setStatus('已复制到剪贴板', 'ready'); } };
$('clear').onclick = () => { if (!confirm('清空面板里的字幕记录？（已自动保存的文件不受影响）')) return; pipe?.transcript.clear(); logItems.clear(); renderEmptyLog(); };
$('sum').onclick = async () => {
  const box = $('summary'); box.classList.remove('hide');
  if (!pipe?.rows().length) { box.textContent = '还没有字幕内容'; return; }
  box.textContent = '正在总结…';
  try { box.textContent = await pipe.summarize(); } catch (e) { box.textContent = '⚠ ' + e.message; }
};
$('resetSpk').onclick = () => pipe?.resetSpeakers();

async function refreshModelInfo() {
  const i = await api.modelsInfo();
  $('modelInfo').textContent = `已下载的模型：${(i.bytes / 1e6).toFixed(0)} MB\n位置：${i.dir}`;
}
$('openModels').onclick = () => api.openModels();
$('delModels').onclick = async () => {
  if (running || mode === 'file') { setStatus('先停止字幕', 'warn'); return; }
  if (!confirm('删除已下载的识别模型？下次开始会重新下载。')) return;
  pipe?.dispose(); pipe = null;
  await api.deleteModels(); refreshModelInfo();
};
refreshModelInfo();

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  for (const id of ['log', 'settings', 'models']) $(id).classList.toggle('hide', b.dataset.tab !== id);
});

// Test hook (read-only): lets automated tests inspect state
window.__livesub = { get pipe() { return pipe; }, get mode() { return mode; }, get settings() { return settings; }, start, stop };
