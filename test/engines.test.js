import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transferPunct } from '../packages/core/src/merge-punct.js';
import { enItn } from '../packages/core/src/en-itn.js';
import { decodeBbpe } from '../packages/core/src/engines/zipformer.js';
import { parseTokens } from '../packages/core/src/engines/ctc.js';
import { BBPE_TABLE } from '../packages/core/src/engines/bbpe-table.js';

test('中文：把 SenseVoice 的标点/阿拉伯数字移植到 Zipformer 结果上', () => {
  assert.equal(transferPunct('接下来跟大家分享的是三月二十九日至四月四日', '接下来跟大家分享的是3月29日至4月4日。'), '接下来跟大家分享的是3月29日至4月4日。');
  // characters follow Zipformer ('影评' is not overwritten by SenseVoice's '影片'), punctuation comes from SenseVoice
  assert.equal(transferPunct('欢迎收看我的影评', '欢迎收看我的影片。'), '欢迎收看我的影评。');
  assert.equal(transferPunct('他盈利多少亏损多少来部门挨个汇报一下', '他盈利多少，亏损多少来部门挨个汇报一下。'), '他盈利多少，亏损多少来部门挨个汇报一下。');
  assert.equal(transferPunct('我们属鼠的朋友出生年份分别为二零二零年', '我们属鼠的朋友，出生年份分别为2020年。'), '我们属鼠的朋友，出生年份分别为2020年。');
  assert.equal(transferPunct('下降了百分之十五', '下降了15%。'), '下降了15%。');
  // numbers don't fully align: keep the Han characters
  assert.equal(transferPunct('大概五百块', '大概600块。'), '大概五百块。');
  assert.equal(transferPunct('', '我。'), '');
  // the Chinese Zipformer model doesn't output Latin words: restore them from SenseVoice
  assert.equal(transferPunct('我从他的里边找到了这些照片', '我从他的APP里边找到了这些照片。'), '我从他的APP里边找到了这些照片。');
  assert.equal(transferPunct('的话不是相对来说开的比较早一些嘛我记得', 'KTV的话不是相对来说开的比较早一些嘛？我记得。'), 'KTV的话不是相对来说开的比较早一些嘛？我记得。');
  assert.equal(transferPunct('我猜测一百二十八G版的Pixel Tablet很可能', '我猜测128G版的Pixel Tablet很可能。'), '我猜测128G版的Pixel Tablet很可能。');
  assert.equal(transferPunct('工人有没有进行裁员', ''), '工人有没有进行裁员');
});

test('英语数字规范化', () => {
  assert.equal(enItn('we grew seven percent in Q four, so we are on a strong trajectory'), 'we grew 7% in Q4, so we are on a strong trajectory');
  assert.equal(enItn('the high expectation for twenty twenty two.'), 'the high expectation for 2022.');
  assert.equal(enItn('You have to remember the sixty million which we saw in twenty twenty.'), 'You have to remember the 60 million which we saw in 2020.');
  assert.equal(enItn('one point five percent to two percent'), '1.5% to 2%');
  assert.equal(enItn('I have two cats and one dog.'), 'I have two cats and one dog.');
  assert.equal(enItn('It costs three hundred and fifty dollars.'), 'It costs 350 dollars.');
  assert.equal(enItn('about twenty-five people came in nineteen ninety nine'), 'about 25 people came in 1999');
  assert.equal(enItn('Let me count: one, two, three.'), 'Let me count: one, two, three.');
  assert.equal(enItn('It was in two thousand and eight.'), 'It was in 2008.');
});

test('字节级 BPE 解码、制表符分隔的词表', () => {
  const rev = []; for (const [k, v] of Object.entries(BBPE_TABLE)) if (rev[v] === undefined) rev[v] = k;
  const enc = (s) => [...new TextEncoder().encode(s)].map(b => rev[b]).join('');
  const t1 = enc('你好'), t2 = enc('世界');
  assert.equal(decodeBbpe(['▁' + t1.slice(0, 2), t1.slice(2), '▁' + t2]), '你好世界');
  assert.equal(decodeBbpe(['▁' + enc('Pixel'), '▁' + enc('Tablet')]), 'Pixel Tablet');
  const t = parseTokens('<blk>\t0\n/\t1\n▁ 2\n  3\n');
  assert.equal(t[0], '<blk>'); assert.equal(t[1], '/'); assert.equal(t[2], '▁'); assert.equal(t[3], ' ');
});

import { parseFixed, acceptFix } from '../packages/core/src/translator.js';
test('AI 校对：解析 JSON、只接受小改动', () => {
  assert.deepEqual(parseFixed('{"src":"今日は寒いですね","dst":"今天好冷啊"}'), { tr: '今天好冷啊', fix: '今日は寒いですね' });
  assert.deepEqual(parseFixed('```json\n{"src": "a", "dst": "b"}\n```'), { tr: 'b', fix: 'a' });
  assert.deepEqual(parseFixed('今天好冷啊'), { tr: '今天好冷啊', fix: null });
  assert.equal(acceptFix('江都は私の庭のようなもの', '江戸は私の庭のようなもの'), '江都は私の庭のようなもの');
  assert.equal(acceptFix('全然違う文章を勝手に書きました', '江戸は私の庭のようなもの'), null);
  assert.equal(acceptFix('', 'abc'), null);
});

import { Translator } from '../packages/core/src/translator.js';
test('识别不确定的句子：提醒大模型、缓存分开', async () => {
  const sent = [];
  const fakeFetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"src":"今日は寒い","dst":"今天很冷"}' } }] }) }; };
  const t = new Translator({ translate: true, translator: 'openai', openaiApiKey: 'k', openaiBaseUrl: 'http://x', openaiModel: 'm', targetLang: 'zh-CN', sourceLang: 'ja' }, fakeFetch);
  const r = await t.translate('今日は寒い', { srcLang: 'ja', unsure: true });
  assert.equal(r.text, '今天很冷');
  assert.match(sent[0].messages.at(-1).content, /^【识别可能有误】/);
  assert.match(sent[0].messages[0].content, /宁可译得含糊/);
});
