// Electron main process: system-audio loopback, caption overlay window, tray, global shortcuts
const { app, BrowserWindow, ipcMain, session, desktopCapturer, protocol, screen, net, Tray, Menu, globalShortcut, dialog, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

if (!app.requestSingleInstanceLock()) app.quit();

const REN = path.join(__dirname, 'renderer');
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

let control = null, overlay = null, tray = null;
let overlayLocked = true;
let overlaySettings = null; // Resend when the overlay loads after the panel

function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); } catch { return {}; } }
function writeState(patch) { try { fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...readState(), ...patch })); } catch {} }

function serveApp() {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    const file = path.normalize(path.join(REN, decodeURIComponent(u.pathname)));
    if (!file.startsWith(REN) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        // Cross-origin isolation -> SharedArrayBuffer -> multi-threaded ONNX, faster CPU inference
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    });
  });
}

function createControl() {
  control = new BrowserWindow({
    width: 420, height: 780, minWidth: 360, minHeight: 500,
    title: 'LiveSub 实时字幕', backgroundColor: '#14161b', autoHideMenuBar: true,
    icon: path.join(REN, 'icon-256.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  control.loadURL('app://local/control.html');
  control.on('close', (e) => {
    // Closing the panel = minimize to tray; captions keep running
    if (!app.isQuitting) { e.preventDefault(); control.hide(); }
  });
  control.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function createOverlay() {
  const wa = screen.getPrimaryDisplay().workArea;
  const saved = readState().overlay;
  const w = Math.round(wa.width * 0.8), h = 220;
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
  overlay.webContents.on('did-finish-load', () => {
    if (overlaySettings) overlay.webContents.send('overlay', { type: 'settings', settings: overlaySettings });
  });
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

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示控制面板', click: () => { control.show(); control.focus(); } },
    { label: '开始 / 停止字幕   Ctrl+Alt+S', click: () => control.webContents.send('toggle') },
    { label: overlayLocked ? '解锁字幕位置（可拖动）   Ctrl+Alt+L' : '锁定字幕位置   Ctrl+Alt+L', click: () => setLocked(!overlayLocked) },
    { label: '显示 / 隐藏字幕   Ctrl+Alt+H', click: toggleOverlay },
    { type: 'separator' },
    { label: '退出 LiveSub', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}
function toggleOverlay() { overlay.isVisible() ? overlay.hide() : overlay.showInactive(); }

app.whenReady().then(() => {
  serveApp();

  // getDisplayMedia -> hand over 'entire screen + system audio (loopback)' without a picker; the renderer stops the video track immediately
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: sources[0], audio: 'loopback' });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'display-capture'].includes(perm)));

  createControl();
  createOverlay();

  tray = new Tray(nativeImage.createFromPath(path.join(REN, 'icon-32.png')));
  tray.setToolTip('LiveSub 实时字幕');
  tray.on('click', () => { control.show(); control.focus(); });
  updateTray();

  globalShortcut.register('Control+Alt+S', () => control.webContents.send('toggle'));
  globalShortcut.register('Control+Alt+L', () => setLocked(!overlayLocked));
  globalShortcut.register('Control+Alt+H', toggleOverlay);
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
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await net.fetch(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body, signal: ctl.signal });
    return { ok: r.ok, status: r.status, text: await r.text() };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.name === 'AbortError' ? '超时' : e.message };
  } finally { clearTimeout(t); }
});

ipcMain.handle('save-file', async (_e, name, content) => {
  const r = await dialog.showSaveDialog(control, { defaultPath: name });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, '﻿' + content, 'utf8');
  return true;
});
