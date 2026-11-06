// Content script: caption layer over the page (Shadow DOM isolates styles; supports dragging and fullscreen)
import { CaptionView, CAPTION_CSS } from '../../../packages/core/src/caption-view.js';

(() => {
  if (window.__livesubInjected) return;
  window.__livesubInjected = true;

  const host = document.createElement('livesub-overlay');
  Object.assign(host.style, {
    position: 'fixed', left: '50%', bottom: '9%', transform: 'translateX(-50%)',
    width: 'min(92vw, 1100px)', zIndex: '2147483647', pointerEvents: 'none',
  });
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CAPTION_CSS + `
    .ls-line{pointer-events:auto;cursor:move;user-select:none}
    .ls-status{pointer-events:auto}`;
  root.appendChild(style);
  const box = document.createElement('div');
  root.appendChild(box);
  const view = new CaptionView(box, { maxLines: 2 });

  const mount = () => (document.fullscreenElement && document.fullscreenElement.tagName !== 'VIDEO'
    ? document.fullscreenElement : document.documentElement).appendChild(host);
  mount();
  document.addEventListener('fullscreenchange', mount);

  // Drag position (double-click to reset)
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    const r = host.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    Object.assign(host.style, { left: e.clientX - drag.dx + 'px', top: e.clientY - drag.dy + 'px', bottom: 'auto', transform: 'none' });
  });
  window.addEventListener('pointerup', () => { drag = null; });
  root.addEventListener('dblclick', () => Object.assign(host.style, { left: '50%', top: 'auto', bottom: '9%', transform: 'translateX(-50%)' }));

  let statusTimer = null;
  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'caption': view.update(msg); break;
      case 'status':
        clearTimeout(statusTimer);
        view.setStatus(msg.state === 'ready' ? '✔ ' + msg.message : msg.message);
        if (msg.state === 'ready' || msg.state === 'warn') statusTimer = setTimeout(() => view.setStatus(''), 4000);
        break;
      case 'settings':
        view.setOptions({ display: msg.settings.display, fontSize: msg.settings.fontSize, bgOpacity: msg.settings.bgOpacity });
        break;
      case 'clear':
        view.clear(); view.setStatus('');
        break;
    }
  });
})();
