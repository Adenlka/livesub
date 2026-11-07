// Translation:
//     google -- free unofficial endpoint (for development/testing)
//     openai -- any OpenAI-compatible API (DeepSeek / OpenAI / Gemini / local Ollama...)
// TranslationManager: merges split sentences, picks the direction from each sentence's language (incl. two-way mode), translates in order, keeps context, caches, validates and falls back
import { TARGET_LANGS, langName, SCENES } from './config.js';
import { looksIncomplete, stripFillers, parsePairs } from './postprocess.js';
import { checkTarget, normalizePunct, baseLang, guessLang } from './lang-text.js';
import { systemPrompt } from './translate-prompts.js';
import { t as tr } from './i18n.js';
import { NOT_JA, countIn } from './zh-script.js';

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

/** Clean a translation: strip prefixes/quotes/multi-line explanations; null when untrustworthy */
export function sanitizeTranslation(out, src, targetLang) {
  if (out == null) return null;
  let t = String(out).trim();
  t = t.replace(/^```[a-z]*\s*|\s*```$/g, '').replace(/\*\*/g, '');
  t = t.replace(/^(译文|翻译|翻譯|中文|日本語訳|訳|译|Translation|Translated|Output|答案)\s*[:：]\s*/i, '');
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  if (!/\n/.test(src)) t = lines[0];
  t = t.replace(/^[「『"“'‘《]+(.*?)[」』"”'’》]+$/s, '$1').trim();
  if (!t) return null;
  if (/需要翻译|前文|仅作参考|Translate the following|Here is the translation|以下是|翻訳します/i.test(t)) return null;
  // models sometimes append their own notes at the end (seen: '...no need to translate fully / truncated') -> strip
  t = t.replace(/(\.\.\.|…)\s*[（(]?(不必|无需|不用|截断|未完|省略|待续|原文|注[:：]|Note)[^。！？]*$/i, '$1').replace(/\s*[（(](注|译注|Note)[:：][^）)]*[）)]\s*$/i, '').trim();
  const len = [...t].length, srcLen = [...src].length;
  if (len > Math.max(40, srcLen * 4)) return null; // too long -> probably an explanation
  t = checkTarget(t, src, targetLang);
  return t == null ? null : normalizePunct(t, targetLang);
}

/** In AI-proofreading mode the model returns {"src": corrected source, "dst": translation}; fall back to a plain translation if parsing fails */
export function parseFixed(raw) {
  const t = String(raw ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const m = /\{[\s\S]*\}/.exec(t);
  if (m) { try { const j = JSON.parse(m[0]); if (typeof j.dst === 'string') return { tr: j.dst, fix: typeof j.src === 'string' ? j.src.replace(/^【识别可能有误】/, '').trim() : null }; } catch {} }
  return { tr: t, fix: null };
}
const lev = (a, b) => { a = [...a]; b = [...b]; let p = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[b.length]; };
/** Only accept small fixes: at most 30% of the source changed (prevents rewriting, polishing or completing) */
export function acceptFix(fix, orig, lang = null) {
  if (!fix) return null;
  // never switch the text to another language's script (seen: Gemini changing Japanese '処罰' into simplified '処罚')
  if (lang === 'ja' && countIn(fix, NOT_JA) > countIn(orig, NOT_JA)) return null;
  if (lang === 'zh' && /[ぁ-ゖァ-ヺ]/.test(fix) && !/[ぁ-ゖァ-ヺ]/.test(orig)) return null;
  const n = (x) => x.replace(/[\s\p{P}]/gu, '');
  const a = n(fix), b = n(orig);
  if (!a || !b) return null;
  if (a === b) return orig;
  return lev(a, b) <= Math.max(1, Math.round([...b].length * 0.3)) ? fix : null;
}

/** Is a recheck result trustworthy: right language, sane length, not an explanation */
export function acceptRecheck(out, asr, lang) {
  let t = out.trim().replace(/^```\w*\s*|\s*```$/g, '').replace(/^[「『"“]|[」』"”]$/g, '').trim();
  if (!t || /\n/.test(t)) return null;
  if (/转写|本机|识别结果|音频|transcri|audio|I cannot|听不清/i.test(t)) return null;
  if (lang === 'ja' || lang === 'zh') t = t.replace(/(?<=[^\sA-Za-z0-9])\s+(?=[^\sA-Za-z0-9])/g, ''); // drop spaces the model inserted into Chinese/Japanese
  const n = (x) => [...x.replace(/[\s\p{P}\p{S}]/gu, '')].length;
  const a = n(t), b = n(asr);
  if (!a || a > Math.max(8, b * 2.5) || a < b * 0.3) return null;
  if (lang === 'ja' && countIn(t, NOT_JA) > countIn(asr, NOT_JA) + 1) return null;
  if (lang === 'zh' && /[ぁ-ゖァ-ヺ]/.test(t) && !/[ぁ-ゖァ-ヺ]/.test(asr)) return null;
  if (lang === 'en' && !/[A-Za-z]/.test(t)) return null;
  return normalizePunct(t, lang);
}

function wavBase64(pcm) {
  const n = pcm.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, pcm[i], true);
  const u = new Uint8Array(b); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Decide what this sentence is translated into:
 *   - sentence language == target -> reverseLang in two-way mode, otherwise not translated
 *   - otherwise -> targetLang
 */
export function pickTarget(srcLang, s) {
  const src = baseLang(srcLang), tgt = baseLang(s.targetLang);
  if (src && src === tgt) return s.reverseLang && baseLang(s.reverseLang) !== src ? s.reverseLang : null;
  return s.targetLang;
}

export class Translator {
  constructor(settings, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    this.s = settings;
    this.fetch = fetchImpl;
    this.history = new Map(); // "src>dst" -> [{src,dst}]
    this.cache = new Map();
    this.nextSlot = 0;          // when rate limited: earliest time the next request may go out
    this.limitedUntil = 0;
  }
  get rateLimited() { return Date.now() < this.limitedUntil; }

  get enabled() { return !!this.s.translate && this.s.translator !== 'none'; }
  /** Cloud recheck: send a low-confidence sentence's audio to an LLM for re-transcription (needs an audio-capable model such as Gemini) */
  get recheckOn() { return this.s.translator === 'openai' && !!this.s.openaiApiKey && this.s.recheck !== false && !this.recheckBroken; }

  /**
   * @param {Int16Array} pcm 16 kHz mono  @returns {Promise<string|null>} rechecked source text; null on failure/timeout/untrusted
   */
  async recheck(pcm, lang, asrText) {
    const s = this.s;
    const L = baseLang(lang) || 'ja';
    const name = { ja: '日语', zh: '中文', en: '英语', ko: '韩语' }[L] ?? '原语言';
    const wait = this.nextSlot - Date.now();
    if (wait > 4000) return null; // rate limited and can't get a slot: use the local result rather than delay the subtitle
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const to = withTimeout(6000);
    try {
      if (this.rateLimited) this.nextSlot = Date.now() + 6500;
      const r = await this.fetch(s.openaiBaseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', signal: to.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.openaiApiKey}` },
        body: JSON.stringify({
          model: s.recheckModel || s.openaiModel, temperature: 0, max_tokens: 400,
          // Gemini Flash 'thinks' for 10+ seconds by default; a transcription only needs 'low' (measured 2-3 s)
          ...(/gemini-[\d.]+-flash(?!-lite)/.test(s.recheckModel || s.openaiModel) ? { reasoning_effort: 'low' } : {}),
          messages: [
            { role: 'system', content: `你是语音转写员。用户会给你一段${name}语音，以及本机语音识别的结果（可能有听错的字词）。以音频为准，输出这段语音准确的逐字转写（${name}原文，不要翻译）。规则：只输出转写文字，不加任何说明；口头禅、语气词可以省略；听不清的地方沿用本机结果；不要补充音频里没有的内容。` },
            { role: 'user', content: [{ type: 'text', text: `本机识别结果：「${asrText}」` }, { type: 'input_audio', input_audio: { data: wavBase64(pcm), format: 'wav' } }] },
          ],
        }),
      });
      if (r.status === 429) { this.limitedUntil = Date.now() + 120000; return null; }
      if (r.status === 400 || r.status === 404 || r.status === 415) { this.recheckBroken = true; return null; } // model doesn't accept audio
      if (!r.ok) return null;
      const data = await r.json();
      return acceptRecheck(String(data.choices?.[0]?.message?.content ?? ''), asrText, L);
    } catch { return null; } finally { to.done(); }
  }

  /** AI proofreading: while translating with an LLM, also fix recognition errors from context (homophones, proper nouns) */
  get fixOn() { return this.s.translator === 'openai' && this.s.asrFix !== false; }

  /** @returns {Promise<{text:string, error?:string, provider?:string, target?:string}>} */
  async translate(text, { srcLang, target, unsure = false } = {}) {
    if (!this.enabled || !text) return { text: '' };
    const src = srcLang || (this.s.sourceLang === 'auto' ? guessLang(text) : this.s.sourceLang) || 'auto';
    const dst = target ?? pickTarget(src, this.s);
    if (!dst) return { text: '', skipped: 'same-language' };
    const clean = stripFillers(text, baseLang(src));
    if (!clean) return { text: '' };
    const key = `${this.s.translator}|${src}>${dst}|${unsure ? '?' : ''}${clean}`;
    if (this.cache.has(key)) return { text: this.cache.get(key), provider: 'cache', target: dst };

    const order = this.s.translator === 'openai' ? ['openai', 'google'] : ['google'];
    let lastErr = '';
    for (const p of order) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const raw = p === 'openai' ? await this._openai(clean, src, dst, unsure) : await this._google(clean, src, dst);
          const { tr, fix } = p === 'openai' && this.fixOn ? parseFixed(raw) : { tr: raw, fix: null };
          const fixed = fix ? acceptFix(fix, clean, baseLang(src)) : null;
          const out = sanitizeTranslation(tr, fixed ?? clean, dst);
          if (out == null) { lastErr = tr('译文校验未通过'); break; }
          const hk = `${baseLang(src)}>${dst}`;
          const h = this.history.get(hk) ?? []; h.push({ src: fixed ?? clean, dst: out }); if (h.length > 4) h.shift(); this.history.set(hk, h);
          this.cache.set(key, out);
          if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
          return { text: out, provider: p, target: dst, fixed: fixed && fixed !== clean ? fixed : null };
        } catch (e) {
          lastErr = e.name === 'AbortError' ? tr('超时') : e.message;
          if (/API Key|401|403/.test(lastErr)) break;
          if (e.rate && attempt === 0) {
            // rate limited: for the next 2 minutes space requests 6.5 s apart (free tier ~10/min) and retry this one after one interval
            this.limitedUntil = Date.now() + 120000;
            await new Promise(r => setTimeout(r, 6500));
          }
        }
      }
    }
    return { text: '', error: lastErr, target: dst };
  }

  _glossary() { return parsePairs(this.s.glossary); }

  async _google(text, src, dst) {
    const tl = TARGET_LANGS.find(l => l.code === dst)?.google ?? dst;
    const sl = src === 'auto' ? 'auto' : baseLang(src);
    let q = text;
    for (const [a, b] of this._glossary()) if (b) q = q.split(a).join(b);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(q)}`;
    const to = withTimeout(6000);
    try {
      const r = await this.fetch(url, { signal: to.signal });
      if (!r.ok) throw new Error('Google 翻译 HTTP ' + r.status);
      const data = await r.json();
      return (data[0] ?? []).map(x => x[0]).join('').trim();
    } finally { to.done(); }
  }

  async _openai(text, src, dst, unsure = false) {
    const s = this.s;
    if (!s.openaiApiKey && !/localhost|127\.0\.0\.1/.test(s.openaiBaseUrl)) throw new Error(tr('未填写 API Key'));
    const fix = this.fixOn;
    const messages = [{ role: 'system', content: systemPrompt({ src, dst, scene: SCENES[s.scene]?.name, glossary: this._glossary(), fix, title: [s.topic, s.pageTitle].filter(Boolean).join(' / ') }) }];
    for (const h of (this.history.get(`${baseLang(src)}>${dst}`) ?? []).slice(-3))
      messages.push({ role: 'user', content: h.src }, { role: 'assistant', content: fix ? JSON.stringify({ src: h.src, dst: h.dst }) : h.dst });
    // low recognition confidence: warn the model that the source may be misheard; vague is better than confidently wrong
    messages.push({ role: 'user', content: unsure ? `【识别可能有误】${text}` : text });
    const to = withTimeout(12000);
    try {
      const r = await this.fetch(s.openaiBaseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', signal: to.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.openaiApiKey}` },
        body: JSON.stringify({ model: s.openaiModel, temperature: 0.2, max_tokens: 300, messages }),
      });
      if (this.rateLimited) this.nextSlot = Date.now() + 6500;
      if (!r.ok) { const e = new Error('大模型接口 HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120)); e.rate = r.status === 429; throw e; }
      const data = await r.json();
      return (data.choices?.[0]?.message?.content ?? '').trim();
    } finally { to.done(); }
  }

  async summarize(transcript) {
    const s = this.s;
    if (s.translator !== 'openai' || !s.openaiApiKey) throw new Error(tr('总结需要在翻译设置里配置大模型 API'));
    const r = await this.fetch(s.openaiBaseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.openaiApiKey}` },
      body: JSON.stringify({
        model: s.openaiModel, temperature: 0.3, max_tokens: 1500,
        messages: [
          { role: 'system', content: `你是会议/课堂记录助手。根据下面的语音识别字幕（可能有识别错误），用${langName(s.targetLang)}写一份简洁的总结：要点（分条）、决定事项/结论、待办（如有，注明负责人）。不要编造字幕里没有的内容。` },
          { role: 'user', content: transcript.slice(-60000) },
        ],
      }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return (await r.json()).choices?.[0]?.message?.content ?? '';
  }
}

/**
 * Sentence merging + in-order translation
 * add() receives final captions in order; an unfinished half-sentence waits briefly and is translated together with the next segment
 * onResult(keys, text, meta): the translation belongs to the last key
 */
export class TranslationManager {
  constructor({ settings, fetch, onResult }) {
    this.translator = new Translator(settings, fetch);
    this.onResult = onResult;
    this.pending = null;
    this.queue = [];
    this.busy = false;
    this.chain = Promise.resolve();
  }
  get settings() { return this.translator.s; }
  set settings(s) { this.translator.s = s; }
  get enabled() { return this.translator.enabled; }

  add({ key, text, speaker = null, cut = false, conf = 1, lang = null, unsure = false }) {
    if (!this.enabled) return;
    const s = this.settings;
    const srcLang = lang || (s.sourceLang === 'auto' ? guessLang(text) : s.sourceLang);
    if (conf < 0.5) { this._flush(); this.onResult([key], '', { skipped: 'low-confidence' }); return; }
    if (!pickTarget(srcLang, s)) { this._flush(); this.onResult([key], '', { skipped: 'same-language' }); return; }
    const p = this.pending;
    const joinable = p && p.speaker === speaker && p.lang === srcLang && p.chars + text.length < 140;
    if (p && !joinable) this._flush();
    if (!this.pending) this.pending = { keys: [], texts: [], speaker, lang: srcLang, chars: 0, timer: null, unsure: false };
    const g = this.pending;
    g.keys.push(key); g.texts.push(text); g.chars += text.length; g.unsure ||= unsure;
    clearTimeout(g.timer);
    const incomplete = cut || looksIncomplete(text, baseLang(srcLang));
    if (!incomplete || g.keys.length >= 4) this._flush();
    else g.timer = setTimeout(() => { if (this.pending === g) this._flush(); }, s.translateHoldMs ?? 1200);
  }

  _flush() {
    const g = this.pending;
    if (!g) return;
    this.pending = null;
    clearTimeout(g.timer);
    this.queue.push(g);
    this._pump();
  }

  /**
   * Translate in order. When the API is rate limited (free Gemini is ~10/min): space requests out,
   * and merge the same speaker's queued sentences in the same language into one request so the queue doesn't fall further behind
   */
  _pump() {
    if (this.busy) return;
    this.busy = true;
    this.chain = (async () => {
      try {
        while (this.queue.length) {
          const wait = this.translator.nextSlot - Date.now();
          if (wait > 0) await new Promise(r => setTimeout(r, wait));
          const g = this.queue.shift();
          while (this.queue.length && this.translator.rateLimited) {
            const n = this.queue[0];
            if (n.speaker !== g.speaker || n.lang !== g.lang || g.chars + n.chars > 220) break;
            this.queue.shift();
            g.keys.push(...n.keys); g.texts.push(...n.texts); g.chars += n.chars; g.unsure ||= n.unsure;
          }
          const L = baseLang(g.lang);
          const sep = L === 'ja' || L === 'zh' ? '' : ' ';
          const text = g.texts.map((t, i) => i < g.texts.length - 1 ? t.replace(/[。．]$/, '') : t).join(sep);
          const r = await this.translator.translate(text, { srcLang: g.lang, unsure: g.unsure });
          this.onResult(g.keys, r.text, { error: r.error, provider: r.provider, merged: g.keys.length > 1, source: text, target: r.target, skipped: r.skipped, fixed: g.keys.length === 1 ? r.fixed : null });
        }
      } finally { this.busy = false; }
    })();
  }

  async flush() { this._flush(); while (this.busy || this.queue.length) await this.chain; }
  summarize(t) { return this.translator.summarize(t); }
}
