import { setUiLang as __ui } from '../packages/core/src/i18n.js'; __ui('zh');
import test from 'node:test';
import assert from 'node:assert/strict';
import { Translator, TranslationManager, sanitizeTranslation } from '../packages/core/src/translator.js';
import { DEFAULT_SETTINGS } from '../packages/core/src/config.js';

const google = (map) => async (url) => {
  const q = decodeURIComponent(url.split('q=')[1]);
  return { ok: true, json: async () => [[[map[q] ?? `<${q}>`]]] };
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('sanitize: 去掉标签/引号，拒绝解释、未翻译、语言不对', () => {
  assert.equal(sanitizeTranslation('译文：「今天下雨」', '今日は雨', 'zh-CN'), '今天下雨');
  assert.equal(sanitizeTranslation('**你好**\n（这是一句问候）', 'こんにちは', 'zh-CN'), '你好');
  assert.equal(sanitizeTranslation('今日は雨です', '今日は雨です', 'zh-CN'), null);           // not translated
  assert.equal(sanitizeTranslation('这句话的意思是：今天下雨了。在日语中，「雨」读作あめ，常用于……'.repeat(3), '今日は雨', 'zh-CN'), null); // an explanation
  assert.equal(sanitizeTranslation('需要翻译的字幕：今天下雨', '今日は雨', 'zh-CN'), null);
  assert.equal(sanitizeTranslation('今天下雨', '今日は雨', 'en'), null);                    // wrong language
  assert.equal(sanitizeTranslation("It's raining today.", '今日は雨', 'en'), "It's raining today.");
});

test('translator: Google 解析 + 术语表预替换 + 缓存', async () => {
  let calls = 0;
  const t = new Translator({ ...DEFAULT_SETTINGS, translate: true, targetLang: "zh-CN", glossary: 'ぺこら=佩克拉' }, async (url) => { calls++; return google({ '佩克拉の配信': '佩克拉的直播' })(url); });
  assert.equal((await t.translate('ぺこらの配信')).text, '佩克拉的直播');
  assert.equal((await t.translate('ぺこらの配信')).provider, 'cache');
  assert.equal(calls, 1);
});

test('translator: 大模型输出可疑 → 自动退回 Google；上下文以对话形式给出', async () => {
  const bodies = [];
  const fetch = async (url, init) => {
    if (url.includes('googleapis')) return google({ 'こんにちは': '你好' })(url);
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'こんにちは' } }] }) }; // not translated
  };
  const t = new Translator({ ...DEFAULT_SETTINGS, translate: true, targetLang: "zh-CN", translator: 'openai', openaiApiKey: 'k' }, fetch);
  const r = await t.translate('こんにちは');
  assert.equal(r.text, '你好');
  assert.equal(r.provider, 'google');
  assert.match(bodies[0].messages[0].content, /只输出一行译文|不要加解释/);

  const good = new Translator({ ...DEFAULT_SETTINGS, translate: true, targetLang: "zh-CN", translator: 'openai', openaiApiKey: 'k', glossary: 'ぺこら=佩克拉', sourceLang: 'ja' }, async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: '译文：你好' } }] }) };
  });
  await good.translate('こんにちは');
  await good.translate('元気？');
  const last = bodies.at(-1).messages;
  assert.match(last[0].content, /ぺこら → 佩克拉/);
  assert.deepEqual(last.slice(1).map(m => m.role), ['user', 'assistant', 'user']);
});

test('translator: 网络错误重试一次；缺 Key 不重试并给出原因', async () => {
  let n = 0;
  const t = new Translator({ ...DEFAULT_SETTINGS, translate: true, targetLang: 'zh-CN' }, async (url) => { if (n++ === 0) throw new Error('net'); return google({ 'テスト': '测试' })(url); });
  assert.equal((await t.translate('テスト')).text, '测试');
  const noKey = new Translator({ ...DEFAULT_SETTINGS, translate: true, targetLang: "zh-CN", translator: 'openai', openaiApiKey: '' }, async (url) => google({ 'テスト': '测试' })(url));
  const r = await noKey.translate('テスト');
  assert.equal(r.text, '测试', '缺 key 时退回 google');
});

test('manager: 半句等待合并后整句翻译，译文挂在最后一段', async () => {
  const results = [];
  const fetch = google({ '気象庁は警戒するとともに雪崩にも注意を呼びかけています。': '气象厅呼吁警惕并注意雪崩。' });
  const m = new TranslationManager({ settings: { ...DEFAULT_SETTINGS, translate: true, targetLang: "zh-CN", translateHoldMs: 200 }, fetch, onResult: (k, t, meta) => results.push({ k, t, meta }) });
  m.add({ key: 10, text: '気象庁は警戒するとともに。', speaker: 0, cut: true });
  await sleep(50);
  assert.equal(results.length, 0, '半句先不翻');
  m.add({ key: 20, text: '雪崩にも注意を呼びかけています。', speaker: 0 });
  await m.flush();
  assert.deepEqual(results[0].k, [10, 20]);
  assert.equal(results[0].t, '气象厅呼吁警惕并注意雪崩。');
  assert.equal(results[0].meta.merged, true);
});

test('manager: 等待超时单独翻译；换人不合并；低置信度不翻译', async () => {
  const results = [];
  const m = new TranslationManager({ settings: { ...DEFAULT_SETTINGS, translate: true, targetLang: "zh-CN", translateHoldMs: 100 }, fetch: google({}), onResult: (k, t, meta) => results.push({ k, t, meta }) });
  m.add({ key: 1, text: '昨日は友達と', speaker: 0 });
  await sleep(250); await m.flush();
  assert.deepEqual(results.map(r => r.k), [[1]]);
  m.add({ key: 2, text: 'それでね、', speaker: 0 });
  m.add({ key: 3, text: 'はい。', speaker: 1 });   // speaker change -> translate the previous group first
  await m.flush();
  assert.deepEqual(results.slice(1).map(r => r.k), [[2], [3]]);
  m.add({ key: 4, text: 'チンディンシジンシア。', speaker: 1, conf: 0.4 });
  assert.equal(results.at(-1).meta.skipped, 'low-confidence');
});
