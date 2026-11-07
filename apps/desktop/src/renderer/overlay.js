import { CaptionView, CAPTION_CSS, viewOptions } from '../../../../packages/core/src/caption-view.js';

document.getElementById('cap').textContent = CAPTION_CSS;
const view = new CaptionView(document.getElementById('root'), { maxLines: 2 });
let statusTimer = null;

window.livesub.onOverlay((m) => {
  switch (m.type) {
    case 'caption': view.update(m); break;
    case 'status':
      clearTimeout(statusTimer);
      if (m.state === 'loading' && m.progress != null && m.progress < 1) view.setStatus(m.message);
      else view.setStatus(m.state === 'ready' ? '✔ ' + m.message : m.message);
      if (m.state !== 'loading' || m.needModel) statusTimer = setTimeout(() => view.setStatus(''), m.state === 'error' ? 12000 : m.needModel ? 6000 : 4000);
      break;
    case 'settings': {
      const s = m.settings;
      view.setOptions(viewOptions(s));
      break;
    }
    case 'clear': view.clear(); view.setStatus(''); break;
    case 'lock':
      document.body.classList.toggle('unlocked', !m.locked);
      if (!m.locked && !view.items.size) view.setStatus('字幕会显示在这里');
      else if (m.locked) view.setStatus('');
      break;
  }
});
