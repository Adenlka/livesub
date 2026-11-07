// Content script: subtitle layer on the page (Shadow DOM style isolation; draggable; follows fullscreen)
import { CaptionView, CAPTION_CSS, viewOptions } from '../../../packages/core/src/caption-view.js';

(() => {
  if (window.__livesubInjected) return;
  window.__livesubInjected = true;

  const host = document.createElement('livesub-overlay');
  const reset = () => Object.assign(host.style, { left: '50%', top: 'auto', bottom: '9%', transform: 'translateX(-50%)' });
  Object.assign(host.style, { position: 'fixed', width: 'min(92vw, 1100px)', zIndex: '2147483647', pointerEvents: 'none' });
  reset();
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CAPTION_CSS + `.ls-line{pointer-events:auto;cursor:move;user-select:none}.ls-status{pointer-events:auto}`;
  root.appendChild(style);
  const box = document.createElement('div');
  root.appendChild(box);
  const view = new CaptionView(box, { maxLines: 2 });

  const mount = () => {
    const fs = document.fullscreenElement;
    (fs && fs.tagName !== 'VIDEO' ? fs : document.documentElement).appendChild(host);
  };
  mount();
  document.addEventListener('fullscreenchange', mount);

  // Drag (position remembered per site), double-click to reset
  const posKey = 'livesub-pos:' + location.host;
  try { const p = JSON.parse(localStorage.getItem(posKey) ?? 'null'); if (p) Object.assign(host.style, p); } catch {}
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    const r = host.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = Math.max(0, Math.min(innerWidth - 80, e.clientX - drag.dx)), y = Math.max(0, Math.min(innerHeight - 40, e.clientY - drag.dy));
    Object.assign(host.style, { left: x + 'px', top: y + 'px', bottom: 'auto', transform: 'none' });
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    try { localStorage.setItem(posKey, JSON.stringify({ left: host.style.left, top: host.style.top, bottom: 'auto', transform: 'none' })); } catch {}
  });
  root.addEventListener('dblclick', () => { reset(); try { localStorage.removeItem(posKey); } catch {} });

  let statusTimer = null, started = false;
  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'caption': started = true; view.update(msg); break;
      case 'status': {
        clearTimeout(statusTimer);
        const pct = msg.state === 'loading' && msg.progress != null && msg.progress < 1 ? '' : '';
        view.setStatus(msg.state === 'ready' ? '✔ ' + msg.message : msg.message + pct);
        if (msg.state !== 'loading' || started) statusTimer = setTimeout(() => view.setStatus(''), msg.state === 'error' ? 12000 : 4000);
        break;
      }
      case 'settings': {
        const s = msg.settings;
        view.setOptions(viewOptions(s));
        break;
      }
      case 'stopped':
        view.setStatus(''); started = false;
        setTimeout(() => view.clear(), 3000);
        break;
    }
  });
})();
