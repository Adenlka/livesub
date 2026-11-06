import { CaptionView, CAPTION_CSS } from '../../../../packages/core/src/caption-view.js';

document.getElementById('cap').textContent = CAPTION_CSS;
const view = new CaptionView(document.getElementById('root'), { maxLines: 2 });
let statusTimer = null;

window.livesub.onOverlay((m) => {
  switch (m.type) {
    case 'caption': view.update(m); break;
    case 'status':
      clearTimeout(statusTimer);
      view.setStatus(m.state === 'ready' ? '✔ ' + m.message : m.message);
      if (m.state === 'ready' || m.state === 'warn') statusTimer = setTimeout(() => view.setStatus(''), 4000);
      break;
    case 'settings': view.setOptions({ display: m.settings.display, fontSize: m.settings.fontSize, bgOpacity: m.settings.bgOpacity }); break;
    case 'clear': view.clear(); view.setStatus(''); break;
    case 'lock':
      document.body.classList.toggle('unlocked', !m.locked);
      if (!m.locked && !view.order.length) view.setStatus('字幕会显示在这里');
      else if (m.locked) view.setStatus('');
      break;
  }
});
