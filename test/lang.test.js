import { setUiLang as __ui } from '../packages/core/src/i18n.js'; __ui('en');
import test from 'node:test';
import assert from 'node:assert/strict';
import { guessLang, normalizePunct, subtitleStyle, checkTarget } from '../packages/core/src/lang-text.js';
import { pickTarget, TranslationManager, Translator, sanitizeTranslation } from '../packages/core/src/translator.js';
import { systemPrompt } from '../packages/core/src/translate-prompts.js';
import { tailText } from '../packages/core/src/caption-view.js';
import { DEFAULT_SETTINGS } from '../packages/core/src/config.js';
import { toSimplified } from '../packages/core/src/zh-script.js';

test('guessLang', () => {
  assert.equal(guessLang('今日は雨です'), 'ja');
  assert.equal(guessLang('今天下雨了'), 'zh');
  assert.equal(guessLang("It's raining today"), 'en');
  assert.equal(guessLang('东京タワー'), 'ja');
  assert.equal(guessLang('yesterday was 星期一'), 'zh');
});

test('punctuation: full-width for zh/ja, half-width for English', () => {
  assert.equal(normalizePunct('你好,今天怎么样?', 'zh-CN'), '你好，今天怎么样？');
  assert.equal(normalizePunct('こんにちは,元気?', 'ja'), 'こんにちは、元気？');
  assert.equal(normalizePunct('好的。 明天 见', 'zh-CN'), '好的。明天见');
  assert.equal(normalizePunct('Hello，how are you？', 'en'), 'Hello, how are you?');
  assert.equal(normalizePunct('He said「yes」。', 'en'), 'He said "yes".');
});

test('subtitle style: drop final period, keep question marks', () => {
  assert.equal(subtitleStyle('今天下雨了。', 'zh'), '今天下雨了');
  assert.equal(subtitleStyle('本当ですか？', 'ja'), '本当ですか？');
  assert.equal(subtitleStyle('It rained.', 'en'), 'It rained.');
  assert.equal(subtitleStyle('好的，明天见。', 'zh', { commaToSpace: true }), '好的 明天见');
});

test('target check: Japanese output needs kana and no simplified characters; traditional/simplified auto-fix', () => {
  assert.equal(checkTarget('今天天气很好', '今日はいい天気', 'ja'), null);          // Chinese pretending to be Japanese
  assert.equal(checkTarget('这个问题们发现了', 'x', 'ja'), null);
  assert.equal(checkTarget('今日はいい天気です', '今天天气很好', 'ja'), '今日はいい天気です');
  assert.equal(checkTarget('今天天氣很好', '今日はいい天気', 'zh-CN'), '今天天气很好'); // traditional -> simplified
  assert.equal(checkTarget('这个软件发布了', 'x', 'zh-TW'), null);               // simplified mixed into traditional -> try another engine
  assert.equal(checkTarget('這個軟體發佈了', 'x', 'zh-TW'), '這個軟體發佈了');
  assert.equal(checkTarget('今日は', '今日は雨です', 'en'), null);
  assert.equal(toSimplified('頭髮與發展'), '头发与发展');
});

test('two-way mode: direction chosen from each sentence\'s language', () => {
  const s = { ...DEFAULT_SETTINGS, translate: true, targetLang: "zh-CN", targetLang: 'zh-CN', reverseLang: 'ja' };
  assert.equal(pickTarget('ja', s), 'zh-CN');
  assert.equal(pickTarget('zh', s), 'ja');
  assert.equal(pickTarget('en', s), 'zh-CN');
  assert.equal(pickTarget('zh', { ...s, reverseLang: '' }), null); // one-way: Chinese is not translated
  assert.equal(pickTarget('en', { ...s, targetLang: 'en', reverseLang: 'zh-CN' }), 'zh-CN');
});

test('prompts are tailored per direction', () => {
  const p1 = systemPrompt({ src: 'ja', dst: 'zh-CN' });
  assert.match(p1, /勉強=学习/); assert.match(p1, /Simplified Chinese/);
  const p2 = systemPrompt({ src: 'zh', dst: 'ja' });
  assert.match(p2, /kanji forms only/); assert.match(p2, /です・ます/);
  const p3 = systemPrompt({ src: 'ja', dst: 'en' });
  assert.match(p3, /^You translate/); assert.match(p3, /lol/);
  assert.match(systemPrompt({ src: 'en', dst: 'zh-TW' }), /Taiwan/);
  assert.match(systemPrompt({ src: 'ja', dst: 'zh-CN', glossary: [['ぺこら', '佩克拉']] }), /ぺこら → 佩克拉/);
});

test('translation zh->ja: LLM answering in Chinese is rejected and falls back to Google; punctuation normalized', async () => {
  const fetch = async (url, init) => {
    if (url.includes('googleapis')) return { ok: true, json: async () => [[['明日は雨が降るでしょう,傘を持ってね']]] };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '明天会下雨，记得带伞' } }] }) };
  };
  const t = new Translator({ ...DEFAULT_SETTINGS, translate: true, targetLang: "zh-CN", sourceLang: 'zh', targetLang: 'ja', translator: 'openai', openaiApiKey: 'k' }, fetch);
  const r = await t.translate('明天会下雨，记得带伞', { srcLang: 'zh' });
  assert.equal(r.provider, 'google');
  assert.equal(r.text, '明日は雨が降るでしょう、傘を持ってね');
});

test('translation manager: same language skipped; two-way translates Chinese into Japanese; different languages not merged', async () => {
  const seen = [];
  const fetch = async (url) => { const q = new URL(url); seen.push(`${q.searchParams.get('sl')}>${q.searchParams.get('tl')}:${q.searchParams.get('q')}`); return { ok: true, json: async () => [[['T']]] }; };
  const out = [];
  const m = new TranslationManager({ settings: { ...DEFAULT_SETTINGS, translate: true, targetLang: "zh-CN", sourceLang: 'auto', targetLang: 'zh-CN', reverseLang: '' }, fetch, onResult: (k, t, meta) => out.push([k, meta.skipped ?? meta.target]) });
  m.add({ key: 1, text: '这是中文。', lang: 'zh' });
  m.add({ key: 2, text: 'これは日本語です。', lang: 'ja' });
  await m.flush();
  assert.deepEqual(out, [[[1], 'same-language'], [[2], 'zh-CN']]);
  m.settings = { ...m.settings, reverseLang: 'ja' };
  m.add({ key: 3, text: '这是中文。', lang: 'zh' });
  await m.flush();
  assert.equal(out.at(-1)[1], 'ja');
  assert.match(seen.at(-1), /^zh>ja:/);
});

test('long lines show only the tail, cut at punctuation', () => {
  const s = '気象庁は雪や路面の凍結による交通への影響、暴風雪や高波に警戒するとともに、雪崩や屋根からの落雪にも十分注意するよう呼びかけています';
  const t = tailText(s, 30);
  assert.ok(t.startsWith('…'));
  assert.ok([...t].length <= 31, t);
  assert.ok(t.endsWith('呼びかけています'));
  assert.equal(tailText('短い', 30), '短い');
});
