// Settings form (shared by the extension popup and the desktop control panel)
import { SOURCE_LANGS, TARGET_LANGS, ENGINES, SCENES, SCENE_KEYS, applyScene } from './config.js';

export const FORM_CSS = `
.lsf{display:flex;flex-direction:column;gap:10px;font-size:13px}
.lsf fieldset{border:1px solid var(--line);border-radius:10px;padding:8px 10px 10px;margin:0;display:flex;flex-direction:column;gap:8px;min-width:0}
.lsf legend{padding:0 4px;color:var(--muted);font-size:12px}
.lsf label{display:flex;align-items:center;justify-content:space-between;gap:8px}
.lsf label>span{flex:none;color:var(--fg)}
.lsf select,.lsf input[type=text],.lsf input[type=password],.lsf input[type=number],.lsf textarea{flex:1;min-width:0;max-width:64%;
  background:var(--field);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:5px 6px;font:inherit}
.lsf textarea{max-width:none;width:100%;min-height:54px;resize:vertical;font-size:12px}
.lsf label.col{flex-direction:column;align-items:stretch;gap:4px}
.lsf input[type=range]{flex:1;max-width:64%}
.lsf input[type=checkbox]{width:16px;height:16px}
.lsf .hint{color:var(--muted);font-size:11px;line-height:1.45;margin:-2px 0 0}
.lsf .scenes{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.lsf .scenes button{padding:7px 2px;border-radius:8px;border:1px solid var(--line);background:var(--field);color:var(--fg);font:inherit;font-size:12px;cursor:pointer}
.lsf .scenes button.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 22%,var(--field));font-weight:600}
.lsf details>summary{cursor:pointer;color:var(--muted);font-size:12px;padding:2px 0;list-style:none}
.lsf details>summary::before{content:'▸ '}.lsf details[open]>summary::before{content:'▾ '}
.lsf details[open]>summary{margin-bottom:8px}
.lsf .hide{display:none}
`;

const opt = (v, t) => `<option value="${v}">${t}</option>`;
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Settings that only take effect after restarting subtitles */
export const RESTART_KEYS = new Set(['engine', 'customModel', 'device', 'diarize', 'sourceLang', 'modelHost', 'vad']);

export function renderSettingsForm(container, settings, onChange) {
  container.classList.add('lsf');
  container.innerHTML = `
  <fieldset><legend>使用场景</legend>
    <div class="scenes">${Object.entries(SCENES).map(([k, v]) => `<button type="button" data-scene="${k}" title="${esc(v.desc)}">${v.name}</button>`).join('')}</div>
    <p class="hint" id="sceneHint"></p>
  </fieldset>
  <fieldset><legend>语言</legend>
    <label><span>说的语言</span><select name="sourceLang">${SOURCE_LANGS.map(l => opt(l.code, l.name)).join('')}</select></label>
    <label><span>翻译</span><select name="translate">${opt('true', '开')}${opt('false', '关')}</select></label>
    <label data-show="translate=true"><span>翻成</span><select name="targetLang">${TARGET_LANGS.map(l => opt(l.code, l.name)).join('')}</select></label>
    <label data-show="translate=true"><span id="revLabel">双向</span><select name="reverseLang">${opt('', '不翻译')}${TARGET_LANGS.map(l => opt(l.code, l.name)).join('')}</select></label>
    <p class="hint" data-show="translate=true" id="revHint"></p>
    <label data-show="translate=true"><span>翻译引擎</span><select name="translator">${opt('google', 'Google（免费，测试用）')}${opt('openai', '大模型 API（推荐，质量最好）')}</select></label>
    <label data-show="translator=openai"><span>API 地址</span><input type="text" name="openaiBaseUrl" spellcheck="false"></label>
    <label data-show="translator=openai"><span>API Key</span><input type="password" name="openaiApiKey" autocomplete="off"></label>
    <label data-show="translator=openai"><span>模型</span><input type="text" name="openaiModel" spellcheck="false"></label>
    <label data-show="translator=openai"><span>AI 校对原文</span><select name="asrFix">${opt('true', '开（按上下文改正同音字、人名）')}${opt('false', '关')}</select></label>
    <p class="hint" data-show="translator=openai">任何 OpenAI 兼容接口：DeepSeek（默认）、OpenAI、本地 Ollama（http://localhost:11434/v1）；Gemini 填 https://generativelanguage.googleapis.com/v1beta/openai ，模型 gemini-3.5-flash-lite（实测约 1~3 秒，免费档每分钟约 10 次，超了会自动合并句子、排队）。大模型出错时会自动退回 Google。</p>
  </fieldset>
  <fieldset><legend>显示</legend>
    <label><span>显示内容</span><select name="display">${opt('both', '原文 + 译文')}${opt('target', '只显示译文')}${opt('source', '只显示原文')}</select></label>
    <label><span>排列</span><select name="layout">${opt('src-top', '原文在上（小字）')}${opt('dst-top', '译文在上')}</select></label>
    <label><span>标点</span><select name="subtitlePunct">${opt('true', '字幕风格（句末不加句号）')}${opt('false', '保留原样')}</select></label>
    <label><span>同时显示</span><select name="maxLines">${opt('1', '1 条')}${opt('2', '2 条')}${opt('3', '3 条')}</select></label>
    <label><span>字号</span><input type="range" name="fontSize" min="16" max="56" step="2"></label>
    <label><span>背景深浅</span><input type="range" name="bgOpacity" min="0" max="0.9" step="0.05"></label>
    <label><span>区分说话人</span><select name="diarize">${opt('true', '开（不同颜色）')}${opt('false', '关')}</select></label>
    <label data-show="diarize=true"><span>显示 A/B 标记</span><select name="showSpeaker">${opt('true', '显示')}${opt('false', '只用颜色')}</select></label>
  </fieldset>
  <details><summary>术语与纠错</summary><fieldset>
    <label class="col"><span>在看什么（可选：主播名、游戏名、节目名，帮助识别人名和专有名词）</span><input type="text" name="topic" placeholder="例：兎田ぺこら マイクラ配信 / 原神 / Elden Ring"></label>
    <p class="hint">插件版会自动读取当前标签页标题，一般不用填。</p>
    <label class="col"><span>术语表（识别热词 + 翻译时强制使用）</span><textarea name="glossary" placeholder="每行一条：原文=译文&#10;ホロライブ=Hololive&#10;田中先生=田中老师"></textarea></label>
    <label class="col"><span>识别纠错（识别后自动替换）</span><textarea name="corrections" placeholder="每行一条：错=对&#10;ペコラ=ぺこら"></textarea></label>
    <p class="hint">人名、作品名、专业词经常被识别或翻译错。术语表的原文会作为识别热词优先识别出来，译文在翻译时强制使用。</p>
  </fieldset></details>
  <details><summary>高级</summary><fieldset>
    <label><span>识别引擎</span><select name="engine">${ENGINES.map(e => opt(e.id, e.name)).join('')}${opt('custom', '自定义 Whisper 模型…')}</select></label>
    <label data-show="engine=custom"><span>模型 ID</span><input type="text" name="customModel" placeholder="onnx-community/…" spellcheck="false"></label>
    <label><span>Whisper 设备</span><select name="device">${opt('auto', '自动（有显卡用 WebGPU）')}${opt('webgpu', 'WebGPU（显卡）')}${opt('wasm', 'CPU')}</select></label>
    <label><span>模型下载源</span><select name="modelHost">${opt('hf', 'Hugging Face')}${opt('mirror', 'hf-mirror.com 镜像')}</select></label>
    <label><span>人声检测</span><select name="vad">${opt('true', '神经网络（抗背景音乐）')}${opt('false', '音量（省资源）')}</select></label>
    <label><span>单条最多字数</span><select name="maxChars">${opt('0', '自动（中日 44 / 英 90）')}${opt('30', '30')}${opt('60', '60')}${opt('120', '120')}</select></label>
    <label><span>断句停顿</span><input type="range" name="silenceMs" min="300" max="1200" step="50"></label>
    <label><span>最长一段</span><input type="range" name="maxSegmentMs" min="5000" max="20000" step="1000"></label>
    <label data-show="diarize=true"><span>快速换人检测</span><select name="splitTurns">${opt('true', '开（会议推荐）')}${opt('false', '关')}</select></label>
    <label data-show="diarize=true"><span>区分灵敏度</span><input type="range" name="speakerThreshold" min="0.3" max="0.7" step="0.05"></label>
    <label data-show="translate=true"><span>半句等待</span><input type="range" name="translateHoldMs" min="0" max="3000" step="100"></label>
    <p class="hint">断句停顿越短字幕越快但越碎。同一人被分成多种颜色 → 灵敏度往左；不同人被当成一个 → 往右。半句等待：话没说完时等多久再翻译（合并成整句翻译更通顺）。</p>
  </fieldset></details>`;

  let s = { ...settings };
  const els = [...container.querySelectorAll('[name]')];
  const parse = (el) => {
    if (el.type === 'range' || el.type === 'number' || el.name === 'maxLines' || el.name === 'maxChars') return Number(el.value);
    if (el.value === 'true') return true;
    if (el.value === 'false') return false;
    return el.value;
  };
  const fill = () => {
    for (const el of els) { const v = s[el.name]; el.value = typeof v === 'boolean' ? String(v) : (v ?? ''); }
    container.querySelectorAll('[data-scene]').forEach(b => b.classList.toggle('on', b.dataset.scene === s.scene));
    const sc = SCENES[s.scene];
    container.querySelector('#sceneHint').textContent = sc ? sc.desc : '自定义参数（点上面的场景可恢复预设）';
  };
  const revHint = () => {
    const t = TARGET_LANGS.find(l => l.code === s.targetLang)?.name ?? s.targetLang;
    container.querySelector('#revLabel').textContent = `说${t}时`;
    container.querySelector('#revHint').textContent = s.reverseLang
      ? `双向模式：其他语言 → ${t}；说${t}的句子 → ${TARGET_LANGS.find(l => l.code === s.reverseLang)?.name}。适合中日、中英等两种语言混着说的会议。说的语言建议选「自动」。`
      : `说的已经是${t}的句子不翻译。`;
  };
  const sync = () => {
    revHint();
    container.querySelectorAll('[data-show]').forEach(n => {
      const [k, v] = n.dataset.show.split('=');
      const parentHidden = k === 'translator' && !s.translate;
      n.classList.toggle('hide', String(s[k]) !== v || parentHidden);
    });
  };
  for (const el of els) {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      s[el.name] = parse(el);
      if (SCENE_KEYS.includes(el.name)) { s.scene = 'custom'; fill(); }
      sync();
      onChange({ ...s }, el.name);
    });
  }
  container.querySelectorAll('[data-scene]').forEach(b => b.addEventListener('click', () => {
    const prev = s;
    s = applyScene(s, b.dataset.scene);
    fill(); sync();
    const changed = SCENE_KEYS.find(k => prev[k] !== s[k]) ?? 'scene';
    onChange({ ...s }, prev.diarize !== s.diarize ? 'diarize' : changed);
  }));
  fill(); sync();
  return { get: () => ({ ...s }), set: (next) => { s = { ...next }; fill(); sync(); } };
}
