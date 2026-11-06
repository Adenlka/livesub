// Settings form (shared by the extension popup and the desktop control panel)
import { SOURCE_LANGS, TARGET_LANGS, MODEL_PRESETS } from './languages.js';

export const FORM_CSS = `
.lsf{display:flex;flex-direction:column;gap:10px;font-size:13px}
.lsf fieldset{border:1px solid var(--line);border-radius:10px;padding:8px 10px 10px;margin:0;display:flex;flex-direction:column;gap:8px}
.lsf legend{padding:0 4px;color:var(--muted);font-size:12px}
.lsf label{display:flex;align-items:center;justify-content:space-between;gap:8px}
.lsf label>span{flex:none;color:var(--fg)}
.lsf select,.lsf input[type=text],.lsf input[type=password],.lsf input[type=number]{flex:1;min-width:0;max-width:62%;
  background:var(--field);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:5px 6px;font:inherit}
.lsf input[type=range]{flex:1;max-width:62%}
.lsf .hint{color:var(--muted);font-size:11px;line-height:1.4;margin:-2px 0 0}
.lsf .hide{display:none}
`;

const opt = (v, t) => `<option value="${v}">${t}</option>`;

export function renderSettingsForm(container, settings, onChange) {
  container.classList.add('lsf');
  container.innerHTML = `
  <fieldset><legend>识别</legend>
    <label><span>说的语言</span><select name="sourceLang">${SOURCE_LANGS.map(l => opt(l.code, l.name)).join('')}</select></label>
    <label><span>识别模型</span><select name="model">${opt('auto', '自动（推荐）')}${MODEL_PRESETS.map(m => opt(m.id, m.name)).join('')}${opt('custom', '自定义 Hugging Face 模型…')}</select></label>
    <label data-show="model=custom"><span>模型 ID</span><input type="text" name="customModel" placeholder="onnx-community/…"></label>
    <label><span>运行设备</span><select name="device">${opt('auto', '自动（有显卡用 WebGPU）')}${opt('webgpu', 'WebGPU（显卡）')}${opt('wasm', 'CPU')}</select></label>
    <p class="hint">首次使用会下载模型（turbo 约 1GB，之后有缓存）。改模型/设备需要重新开始。</p>
  </fieldset>
  <fieldset><legend>翻译</legend>
    <label><span>翻译</span><select name="translate">${opt('true', '开')}${opt('false', '关')}</select></label>
    <label data-show="translate=true"><span>翻成</span><select name="targetLang">${TARGET_LANGS.map(l => opt(l.code, l.name)).join('')}</select></label>
    <label data-show="translate=true"><span>翻译引擎</span><select name="translator">${opt('google', 'Google（免费，测试用）')}${opt('openai', '大模型 API（质量最好）')}</select></label>
    <label data-show="translator=openai"><span>API 地址</span><input type="text" name="openaiBaseUrl"></label>
    <label data-show="translator=openai"><span>API Key</span><input type="password" name="openaiApiKey" autocomplete="off"></label>
    <label data-show="translator=openai"><span>模型</span><input type="text" name="openaiModel"></label>
    <p class="hint" data-show="translator=openai">任何 OpenAI 兼容接口都行：DeepSeek、OpenAI、Gemini、本地 Ollama（http://localhost:11434/v1）。</p>
  </fieldset>
  <fieldset><legend>多人</legend>
    <label><span>区分说话人</span><select name="diarize">${opt('true', '开（不同颜色）')}${opt('false', '关')}</select></label>
    <label data-show="diarize=true"><span>区分灵敏度</span><input type="range" name="speakerThreshold" min="0.25" max="0.7" step="0.05"></label>
    <p class="hint" data-show="diarize=true">同一人被分成多种颜色 → 往左调；不同人被当成一个人 → 往右调。</p>
  </fieldset>
  <fieldset><legend>显示</legend>
    <label><span>显示内容</span><select name="display">${opt('both', '原文 + 译文')}${opt('target', '只显示译文')}${opt('source', '只显示原文')}</select></label>
    <label><span>字号</span><input type="range" name="fontSize" min="16" max="56" step="2"></label>
    <label><span>背景深浅</span><input type="range" name="bgOpacity" min="0" max="0.9" step="0.05"></label>
    <label><span>断句停顿</span><input type="range" name="silenceMs" min="300" max="1200" step="50"></label>
    <p class="hint">断句停顿越短，字幕出得越快但句子越碎（日语建议 450–650ms）。</p>
  </fieldset>`;

  const s = { ...settings };
  const els = [...container.querySelectorAll('[name]')];
  const parse = (el) => {
    if (el.type === 'range' || el.type === 'number') return Number(el.value);
    if (el.value === 'true') return true;
    if (el.value === 'false') return false;
    return el.value;
  };
  const sync = () => {
    container.querySelectorAll('[data-show]').forEach(n => {
      const [k, v] = n.dataset.show.split('=');
      const parentHidden = k === 'translator' && !s.translate;
      n.classList.toggle('hide', String(s[k]) !== v || parentHidden);
    });
  };
  for (const el of els) {
    const v = s[el.name];
    el.value = typeof v === 'boolean' ? String(v) : (v ?? '');
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      s[el.name] = parse(el);
      sync();
      onChange({ ...s }, el.name);
    });
  }
  sync();
  return { get: () => ({ ...s }) };
}

/** Settings that only take effect after restarting */
export const RESTART_KEYS = new Set(['model', 'customModel', 'device', 'diarize']);
