// Settings form (shared by the extension popup and the desktop control panel)
import { SOURCE_LANGS, TARGET_LANGS, ENGINES, SCENES, SCENE_KEYS, applyScene } from './config.js';
import { t, translateDOM } from './i18n.js';

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
  <fieldset><legend>Scenario</legend>
    <div class="scenes">${Object.entries(SCENES).map(([k, v]) => `<button type="button" data-scene="${k}" title="${esc(v.desc)}">${v.name}</button>`).join('')}</div>
    <p class="hint" id="sceneHint"></p>
  </fieldset>
  <fieldset><legend>Language</legend>
    <label><span>Spoken language</span><select name="sourceLang">${SOURCE_LANGS.map(l => opt(l.code, l.name)).join('')}</select></label>
    <label><span>Translation</span><select name="translate">${opt('true', 'On')}${opt('false', 'Off')}</select></label>
    <label data-show="translate=true"><span>Translate to</span><select name="targetLang">${TARGET_LANGS.map(l => opt(l.code, l.name)).join('')}</select></label>
    <label data-show="translate=true"><span id="revLabel">Two-way</span><select name="reverseLang">${opt('', 'Don\'t translate')}${TARGET_LANGS.map(l => opt(l.code, l.name)).join('')}</select></label>
    <p class="hint" data-show="translate=true" id="revHint"></p>
    <label data-show="translate=true"><span>Translator</span><select name="translator">${opt('google', 'Google (free, for testing)')}${opt('openai', 'LLM API (recommended, best quality)')}</select></label>
    <label data-show="translator=openai"><span>API URL</span><input type="text" name="openaiBaseUrl" spellcheck="false"></label>
    <label data-show="translator=openai"><span>API Key</span><input type="password" name="openaiApiKey" autocomplete="off"></label>
    <label data-show="translator=openai"><span>Model</span><input type="text" name="openaiModel" spellcheck="false"></label>
    <label data-show="translator=openai"><span>AI proofreading</span><select name="asrFix">${opt('true', 'On (fixes homophones and names from context)')}${opt('false', 'Off')}</select></label>
    <label data-show="translator=openai"><span>Cloud recheck</span><select name="recheck">${opt('true', 'On (only low-confidence lines are re-transcribed)')}${opt('false', 'Off')}</select></label>
    <p class="hint" data-show="translator=openai">Any OpenAI-compatible API: DeepSeek (default), OpenAI, local Ollama (http://localhost:11434/v1). For Gemini use https://generativelanguage.googleapis.com/v1beta/openai with model gemini-3.5-flash-lite (about 1–3 s; the free tier allows ~10 requests/min, beyond that sentences are merged and queued). Falls back to Google on errors.</p>
  </fieldset>
  <fieldset><legend>Display</legend>
    <label><span>Show</span><select name="display">${opt('both', 'Original + translation')}${opt('target', 'Translation only')}${opt('source', 'Original only')}</select></label>
    <label><span>Layout</span><select name="layout">${opt('src-top', 'Original on top (small)')}${opt('dst-top', 'Translation on top')}</select></label>
    <label><span>Punctuation</span><select name="subtitlePunct">${opt('true', 'Subtitle style (no final period)')}${opt('false', 'Keep as is')}</select></label>
    <label><span>Lines shown</span><select name="maxLines">${opt('1', '1 sentence')}${opt('2', '2 sentences (recommended)')}${opt('3', '3 sentences')}</select></label>
    <label><span>Subtitle box width</span><input type="range" name="boxWidth" min="40" max="100" step="5"></label>
    <label><span>Font size</span><input type="range" name="fontSize" min="16" max="56" step="2"></label>
    <label><span>Background opacity</span><input type="range" name="bgOpacity" min="0" max="0.9" step="0.05"></label>
    <label><span>Distinguish speakers (Beta)</span><select name="diarize">${opt('false', 'Off')}${opt('true', 'On (colors, experimental)')}</select></label>
    <label data-show="diarize=true"><span>Show A/B tags</span><select name="showSpeaker">${opt('true', 'Display')}${opt('false', 'Color only')}</select></label>
    <label class="ext-only"><span>Transcript</span><select name="keepTranscript">${opt('false', 'Off (keep only recent lines, saves memory)')}${opt('true', 'On (full transcript, exportable)')}</select></label>
  </fieldset>
  <details><summary>Glossary &amp; corrections</summary><fieldset>
    <label class="col"><span>What you're watching (optional: streamer, game or show name — helps with names and terms)</span><input type="text" name="topic" placeholder="e.g. Usada Pekora Minecraft stream / Genshin / Elden Ring"></label>
    <p class="hint">The extension reads the current tab title automatically, so this is usually unnecessary.</p>
    <label class="col"><span>Glossary (recognition hotwords + enforced translations)</span><textarea name="glossary" placeholder="One per line: source=translation&#10;ホロライブ=Hololive&#10;田中先生=Mr. Tanaka"></textarea></label>
    <label class="col"><span>Corrections (auto-replace after recognition)</span><textarea name="corrections" placeholder="One per line: wrong=right&#10;ペコラ=ぺこら"></textarea></label>
    <p class="hint">Names, titles and jargon are often misrecognized or mistranslated. Glossary source terms are boosted during recognition, and their translations are enforced.</p>
  </fieldset></details>
  <details><summary>Advanced</summary><fieldset>
    <label><span>Recognition engine</span><select name="engine">${ENGINES.map(e => opt(e.id, e.name)).join('')}${opt('custom', 'Custom Whisper model…')}</select></label>
    <label data-show="engine=custom"><span>Model ID</span><input type="text" name="customModel" placeholder="onnx-community/…" spellcheck="false"></label>
    <label><span>Whisper device</span><select name="device">${opt('auto', 'Auto (WebGPU if available)')}${opt('webgpu', 'WebGPU (GPU)')}${opt('wasm', 'CPU')}</select></label>
    <label><span>Model source</span><select name="modelHost">${opt('hf', 'Hugging Face')}${opt('mirror', 'hf-mirror.com mirror')}</select></label>
    <label><span>Voice detection</span><select name="vad">${opt('true', 'Neural (robust to music)')}${opt('false', 'Volume (lightweight)')}</select></label>
    <label><span>Max characters per line</span><select name="maxChars">${opt('0', 'Auto (CJK 44 / English 90)')}${opt('30', '30')}${opt('60', '60')}${opt('120', '120')}</select></label>
    <label><span>Sentence pause</span><input type="range" name="silenceMs" min="300" max="1200" step="50"></label>
    <label><span>Max segment length</span><input type="range" name="maxSegmentMs" min="5000" max="20000" step="1000"></label>
    <label data-show="diarize=true"><span>Fast speaker-change detection</span><select name="splitTurns">${opt('true', 'On (recommended for meetings)')}${opt('false', 'Off')}</select></label>
    <label data-show="diarize=true"><span>Speaker sensitivity</span><input type="range" name="speakerThreshold" min="0.3" max="0.7" step="0.05"></label>
    <label data-show="translate=true"><span>Mid-sentence wait</span><input type="range" name="translateHoldMs" min="0" max="3000" step="100"></label>
    <p class="hint">A shorter pause gives faster but choppier subtitles. One person split into several colors → move sensitivity left; different people merged → right. Mid-sentence wait: how long to wait before translating an unfinished sentence (whole sentences translate better).</p>
  </fieldset></details>`;
  translateDOM(container);

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
    container.querySelector('#sceneHint').textContent = sc ? t(sc.desc) : t('Custom settings (tap a scenario above to restore its preset)');
  };
  const revHint = () => {
    const tl = t(TARGET_LANGS.find(l => l.code === s.targetLang)?.name ?? s.targetLang);
    container.querySelector('#revLabel').textContent = t('When speaking {t}', { t: tl });
    container.querySelector('#revHint').textContent = s.reverseLang
      ? t('Two-way mode: other languages → {t}; sentences in {t} → {r}. For meetings mixing two languages. Set the spoken language to "Auto".', { t: tl, r: t(TARGET_LANGS.find(l => l.code === s.reverseLang)?.name ?? '') })
      : t('Sentences already in {t} are not translated.', { t: tl });
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
