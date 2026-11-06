// Translation: google (free unofficial endpoint, for development only) / openai (any OpenAI-compatible API: DeepSeek, OpenAI, Qwen, local Ollama, ...)
import { TARGET_LANGS, langName } from './languages.js';

const SRC_NAMES = { ja: '日语', en: '英语', zh: '中文', ko: '韩语', ms: '马来语', auto: '原文' };

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

export class Translator {
  constructor(settings, fetchImpl = globalThis.fetch.bind(globalThis)) {
    this.s = settings;
    this.fetch = fetchImpl;
    this.history = []; // The last few source/translation pairs, given to the LLM as context
  }

  get enabled() { return this.s.translate && this.s.translator !== 'none'; }

  async translate(text) {
    if (!this.enabled || !text) return '';
    const src = this.s.sourceLang;
    if (src !== 'auto' && this.s.targetLang.startsWith(src)) return '';
    let out = '';
    try {
      out = this.s.translator === 'openai' ? await this._openai(text) : await this._google(text);
    } catch (e) {
      return `⚠ 翻译失败：${e.name === 'AbortError' ? '超时' : e.message}`;
    }
    this.history.push({ src: text, dst: out });
    if (this.history.length > 4) this.history.shift();
    return out;
  }

  async _google(text) {
    const tl = TARGET_LANGS.find(l => l.code === this.s.targetLang)?.google ?? this.s.targetLang;
    const sl = this.s.sourceLang === 'auto' ? 'auto' : this.s.sourceLang;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const to = withTimeout(6000);
    try {
      const r = await this.fetch(url, { signal: to.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      return (data[0] ?? []).map(x => x[0]).join('').trim();
    } finally { to.done(); }
  }

  async _openai(text) {
    const s = this.s;
    if (!s.openaiApiKey && !/localhost|127\.0\.0\.1/.test(s.openaiBaseUrl)) throw new Error('未填写 API Key');
    const srcName = SRC_NAMES[s.sourceLang] ?? '原文';
    const dstName = langName(s.targetLang);
    const sys = [
      `你是直播/视频的实时字幕翻译。把${srcName}口语字幕翻译成${dstName}。`,
      '要求：只输出译文本身，不要解释、不要引号、不要注音；译文简短自然，像字幕。',
      '原文来自语音识别，可能有同音字错误或断句不完整：按上下文推断正确意思翻译，不完整的句子就译出已有部分。',
      s.sourceLang === 'ja'
        ? '日语注意：省略的主语按上下文补全；敬语、终助词（ね、よ、な）、口癖译成自然的口语语气；人名、作品名、游戏用语保留常见译名或原文；「草」「w」类网络用语译成对应的笑声/网络用语。'
        : '',
    ].filter(Boolean).join('\n');
    const ctx = this.history.map(h => `${h.src} => ${h.dst}`).join('\n');
    const user = ctx ? `前文（仅作参考，不要翻译）：\n${ctx}\n\n需要翻译的字幕：\n${text}` : text;

    const to = withTimeout(10000);
    try {
      const r = await this.fetch(s.openaiBaseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        signal: to.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.openaiApiKey}` },
        body: JSON.stringify({
          model: s.openaiModel,
          temperature: 0.2,
          max_tokens: 300,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
      const data = await r.json();
      return (data.choices?.[0]?.message?.content ?? '').trim();
    } finally { to.done(); }
  }
}
