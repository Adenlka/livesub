// Electron main process: system-audio loopback, subtitle overlay window, model downloads, tray, global shortcuts, transcript autosave
const { app, BrowserWindow, ipcMain, session, desktopCapturer, protocol, screen, net, Tray, Menu, globalShortcut, dialog, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { ensureModels, modelInfo } = require('./models.js');
const { t, setUiLang } = require('../../../../packages/core/src/i18n.js');
app.whenReady().then(() => setUiLang(app.getLocale()));

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();

const REN = path.join(__dirname, 'renderer');
const userDir = () => app.getPath('userData');
const MODELS_DIR = () => path.join(userDir(), 'models');
const STATE_FILE = () => path.join(userDir(), 'window-state.json');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.onnx': 'application/octet-stream', '.txt': 'text/plain' };

let control = null, overlay = null, tray = null;
let overlayLocked = true, overlaySettings = null;
let saveFile = null; // current transcript autosave file

function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); } catch { return {}; } }
function writeState(patch) { try { fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...readState(), ...patch })); } catch {} }

function serveApp() {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    const p = decodeURIComponent(u.pathname);
    const inside = (f, dir) => f === dir || f.startsWith(dir + path.sep);
    const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
    let hit = null;
    if (p.startsWith('/models/')) {
      // Downloaded models live in userData/models; the bundled Silero VAD is in renderer/models
      const userFile = path.normalize(path.join(MODELS_DIR(), p.slice('/models/'.length)));
      const builtin = path.normalize(path.join(REN, p));
      hit = [[userFile, MODELS_DIR()], [builtin, REN]].find(([f, d]) => inside(f, d) && exists(f))?.[0];
    } else {
      const f = path.normalize(path.join(REN, p));
      if (inside(f, REN) && exists(f)) hit = f;
    }
    if (!hit) return new Response('not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(hit).toString());
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': MIME[path.extname(hit)] ?? 'application/octet-stream',
        // Cross-origin isolation -> SharedArrayBuffer -> multi-threaded ONNX (2-3x faster CPU recognition)
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  });
}

function createControl() {
  const st = readState().control;
  control = new BrowserWindow({
    width: st?.width ?? 440, height: st?.height ?? 820, x: st?.x, y: st?.y, minWidth: 380, minHeight: 520,
    title: t('LiveSub 实时字幕'), backgroundColor: '#14161b', autoHideMenuBar: true, icon: path.join(REN, 'icon-256.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  control.loadURL('app://local/control.html');
  control.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); control.hide(); notifyTray(); } });
  const save = () => writeState({ control: control.getBounds() });
  control.on('moved', save); control.on('resized', save);
  control.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

let trayHinted = false;
function notifyTray() {
  if (trayHinted || !tray) return;
  trayHinted = true;
  tray.displayBalloon?.({ title: t('LiveSub 还在运行'), content: t('字幕会继续显示。点托盘图标打开面板，右键可退出。') });
}

function createOverlay() {
  const wa = screen.getPrimaryDisplay().workArea;
  const saved = readState().overlay;
  const w = Math.round(wa.width * 0.8), h = 240;
  overlay = new BrowserWindow({
    x: saved?.x ?? wa.x + Math.round((wa.width - w) / 2), y: saved?.y ?? wa.y + wa.height - h - 40,
    width: saved?.width ?? w, height: saved?.height ?? h,
    transparent: true, frame: false, resizable: true, movable: true, hasShadow: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true);
  overlay.loadURL('app://local/overlay.html');
  overlay.once('ready-to-show', () => { overlay.showInactive(); setLocked(true); });
  overlay.webContents.on('did-finish-load', () => { if (overlaySettings) overlay.webContents.send('overlay', { type: 'settings', settings: overlaySettings }); });
  const save = () => writeState({ overlay: overlay.getBounds() });
  overlay.on('moved', save); overlay.on('resized', save);
}

function setLocked(v) {
  overlayLocked = v;
  if (!overlay) return;
  overlay.setIgnoreMouseEvents(v, { forward: true });
  overlay.setFocusable(!v);
  overlay.webContents.send('overlay', { type: 'lock', locked: v });
  control?.webContents.send('overlay-lock', v);
  updateTray();
}
function toggleOverlay() { overlay.isVisible() ? overlay.hide() : overlay.showInactive(); }

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('显示控制面板'), click: () => { control.show(); control.focus(); } },
    { label: t('开始 / 停止字幕') + '   Ctrl+Alt+S', click: () => control.webContents.send('toggle') },
    { label: (overlayLocked ? t('解锁字幕位置（可拖动）') : t('锁定字幕位置')) + '   Ctrl+Alt+L', click: () => setLocked(!overlayLocked) },
    { label: t('显示 / 隐藏字幕') + '   Ctrl+Alt+H', click: toggleOverlay },
    { label: t('打开字幕记录文件夹'), click: () => shell.openPath(transcriptDir()) },
    { type: 'separator' },
    { label: t('退出 LiveSub'), click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function transcriptDir() {
  const d = path.join(app.getPath('documents'), 'LiveSub');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

app.whenReady().then(() => {
  serveApp();
  // getDisplayMedia -> hand over 'entire screen + system audio (loopback)' without a picker; the renderer stops the video track immediately
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: sources[0], audio: 'loopback' });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'display-capture', 'clipboard-sanitized-write'].includes(perm)));

  createControl();
  createOverlay();
  tray = new Tray(nativeImage.createFromPath(path.join(REN, 'icon-32.png')));
  tray.setToolTip(t('LiveSub 实时字幕'));
  tray.on('click', () => { control.show(); control.focus(); });
  updateTray();
  const reg = (acc, fn) => { try { if (!globalShortcut.register(acc, fn)) console.warn('快捷键被占用', acc); } catch {} };
  reg('Control+Alt+S', () => control.webContents.send('toggle'));
  reg('Control+Alt+L', () => setLocked(!overlayLocked));
  reg('Control+Alt+H', toggleOverlay);
});

app.on('second-instance', () => { control?.show(); control?.focus(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { app.isQuitting = true; });

// —— IPC ——
ipcMain.on('caption', (_e, c) => overlay?.webContents.send('overlay', { type: 'caption', ...c }));
ipcMain.on('status', (_e, s) => overlay?.webContents.send('overlay', { type: 'status', ...s }));
ipcMain.on('overlay-settings', (_e, s) => { overlaySettings = s; overlay?.webContents.send('overlay', { type: 'settings', settings: s }); });
ipcMain.on('overlay-clear', () => overlay?.webContents.send('overlay', { type: 'clear' }));
ipcMain.on('overlay-lock', (_e, v) => setLocked(v));
ipcMain.handle('overlay-locked', () => overlayLocked);

// Translation requests go through the main process (no browser CORS limits)
ipcMain.handle('net-fetch', async (_e, url, init = {}) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await net.fetch(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body, signal: ctl.signal });
    return { ok: r.ok, status: r.status, text: await r.text() };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.name === 'AbortError' ? t('超时') : e.message };
  } finally { clearTimeout(t); }
});

ipcMain.handle('models-ensure', async (e, specs) => {
  try {
    const r = await ensureModels(MODELS_DIR(), specs, (p) => e.sender.send('models-progress', p));
    return { ok: true, ...r };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('models-info', () => modelInfo(MODELS_DIR()));
ipcMain.handle('models-open', () => { fs.mkdirSync(MODELS_DIR(), { recursive: true }); return shell.openPath(MODELS_DIR()); });
ipcMain.handle('models-delete', () => { fs.rmSync(MODELS_DIR(), { recursive: true, force: true }); return true; });

ipcMain.handle('save-file', async (_e, name, content) => {
  // Automated tests: no dialog, write straight to the given directory
  if (process.env.LIVESUB_TEST_SAVE_DIR) {
    const f = path.join(process.env.LIVESUB_TEST_SAVE_DIR, name);
    fs.writeFileSync(f, content, 'utf8');
    return f;
  }
  const r = await dialog.showSaveDialog(control, { defaultPath: path.join(transcriptDir(), name) });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, (name.endsWith('.vtt') ? '' : '﻿') + content, 'utf8');
  return r.filePath;
});

// Autosave: one new file per subtitle session, appended line by line
ipcMain.handle('autosave-begin', (_e, label) => {
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`; // local time
  saveFile = path.join(transcriptDir(), `${stamp}${label ? '-' + label.replace(/[\\/:*?"<>|]/g, '_') : ''}.txt`);
  fs.writeFileSync(saveFile, '﻿', 'utf8');
  return saveFile;
});
ipcMain.on('autosave-append', (_e, text) => { if (saveFile) fs.appendFile(saveFile, text + '\n', () => {}); });
ipcMain.handle('open-transcripts', () => shell.openPath(transcriptDir()));
