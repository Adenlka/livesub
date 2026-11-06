import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechSegmenter } from '../packages/core/src/segmenter.js';
import { Resampler } from '../packages/core/src/resample.js';
import { cleanText, isHallucination } from '../packages/core/src/postprocess.js';
import { Translator } from '../packages/core/src/translator.js';
import { DEFAULT_SETTINGS } from '../packages/core/src/languages.js';

const R = 16000;
const tone = (ms, amp = 0.2) => Float32Array.from({ length: R * ms / 1000 }, (_, i) => amp * Math.sin(i / 8));
const noise = (ms, amp = 0.001) => Float32Array.from({ length: R * ms / 1000 }, () => (Math.random() - .5) * amp);
const cat = (...a) => { const o = new Float32Array(a.reduce((s, x) => s + x.length, 0)); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };

test('segmenter: 两句话被静音隔开 → 两个 final', () => {
  const finals = [];
  const s = new SpeechSegmenter({ onFinal: f => finals.push(f) });
  s.push(cat(noise(500), tone(1200), noise(800), tone(900), noise(900)));
  assert.equal(finals.filter(f => f.audio).length, 2);
  const len = finals[0].audio.length / R;
  assert.ok(len > 1.1 && len < 1.8, 'first segment length ' + len);
});

test('segmenter: 极短噪声不出字幕', () => {
  const finals = [];
  const s = new SpeechSegmenter({ onFinal: f => finals.push(f) });
  s.push(cat(noise(300), tone(100), noise(1000)));
  assert.equal(finals.filter(f => f.audio).length, 0);
});

test('segmenter: 连续语音（BGM）按最大长度在低能量处切开', () => {
  const finals = [];
  const s = new SpeechSegmenter({ maxSegmentMs: 4000, onFinal: f => finals.push(f) });
  s.push(cat(noise(300), tone(3000), tone(150, 0.02), tone(3000), noise(1000)));
  const ok = finals.filter(f => f.audio);
  assert.ok(ok.length >= 2);
  ok.forEach(f => assert.ok(f.audio.length / R <= 4.05));
});

test('segmenter: 说话期间产生 partial', () => {
  const partials = [];
  const s = new SpeechSegmenter({ onPartial: p => partials.push(p) });
  s.push(cat(noise(200), tone(3500)));
  assert.ok(partials.length >= 2);
});

test('resampler: 48k → 16k 长度正确且跨块连续', () => {
  const r = new Resampler(48000);
  let n = 0;
  for (let i = 0; i < 10; i++) n += r.process(new Float32Array(480)).length;
  assert.ok(Math.abs(n - 1600) <= 1, 'got ' + n);
  const r2 = new Resampler(44100);
  let m = 0;
  for (let i = 0; i < 100; i++) m += r2.process(new Float32Array(441)).length;
  assert.ok(Math.abs(m - 16000) <= 2, 'got ' + m);
});

test('postprocess: 日语幻听与重复', () => {
  assert.equal(cleanText('ご視聴ありがとうございました', 'ja'), '');
  assert.equal(cleanText('チャンネル登録よろしくお願いします', 'ja'), '');
  assert.equal(cleanText('♪', 'ja'), '');
  assert.equal(cleanText('(音楽)', 'ja'), '');
  assert.equal(cleanText('今日は 雨 です', 'ja'), '今日は雨です');
  assert.equal(cleanText('そうそうそうそうそうそう', 'ja'), 'そう');
  assert.equal(cleanText('ありがとうございます', 'ja'), 'ありがとうございます');
  assert.equal(isHallucination('Thank you for watching!'), true);
  assert.equal(cleanText('Hello world', 'en'), 'Hello world');
});

test('translator: google 解析 + openai 请求格式', async () => {
  const g = new Translator({ ...DEFAULT_SETTINGS }, async (url) => {
    assert.match(url, /sl=ja&tl=zh-CN/);
    return { ok: true, json: async () => [[['今天', 'x'], ['下雨', 'y']]] };
  });
  assert.equal(await g.translate('今日は雨'), '今天下雨');

  let body;
  const o = new Translator({ ...DEFAULT_SETTINGS, translator: 'openai', openaiApiKey: 'k' }, async (url, init) => {
    assert.match(url, /\/chat\/completions$/);
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: ' 你好 ' } }] }) };
  });
  assert.equal(await o.translate('こんにちは'), '你好');
  assert.match(body.messages[0].content, /日语/);
  await o.translate('元気？');
  assert.match(body.messages[1].content, /こんにちは => 你好/);

  const noKey = new Translator({ ...DEFAULT_SETTINGS, translator: 'openai', openaiApiKey: '' });
  assert.match(await noKey.translate('x'), /API Key/);
});

test('speaker: 两个不同声纹被分开，相似声纹归同一人', async () => {
  const { SpeakerClusterer } = await import('../packages/core/src/speaker.js');
  const rnd = (seed) => { let x = seed; return () => (x = (x * 16807) % 2147483647) / 2147483647 - 0.5; };
  const base = (seed) => { const r = rnd(seed); return Float32Array.from({ length: 256 }, r); };
  const jitter = (v, seed, amt = 0.25) => { const r = rnd(seed); return Float32Array.from(v, x => x + r() * amt * 0.3); };
  const A = base(7), B = base(99);
  const c = new SpeakerClusterer();
  assert.equal(c.assign(jitter(A, 1), 2), 0);
  assert.equal(c.assign(jitter(B, 2), 2), 1);
  assert.equal(c.assign(jitter(A, 3), 2), 0);
  assert.equal(c.assign(jitter(B, 4), 0.6), 1); // short sentence
  assert.equal(c.speakers.length, 2);
});
