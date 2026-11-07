import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechSegmenter } from '../packages/core/src/segmenter.js';
import { Resampler } from '../packages/core/src/resample.js';
import { cleanText, isHallucination, looksIncomplete, stripFillers, parsePairs } from '../packages/core/src/postprocess.js';
import { SpeakerClusterer } from '../packages/core/src/speaker.js';
import { DEFAULT_SETTINGS, applyScene, resolveEngine, requiredModels, modelUrls, SCENES } from '../packages/core/src/config.js';

const R = 16000;
const tone = (ms, amp = 0.2) => Float32Array.from({ length: R * ms / 1000 }, (_, i) => amp * Math.sin(i / 8));
const noise = (ms, amp = 0.001) => Float32Array.from({ length: R * ms / 1000 }, () => (Math.random() - .5) * amp);
const cat = (...a) => { const o = new Float32Array(a.reduce((s, x) => s + x.length, 0)); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };

test('segmenter(能量): 两句话被静音隔开 → 两个 final，带时间轴与逐帧分数', async () => {
  const finals = [];
  const s = new SpeechSegmenter({ onFinal: f => finals.push(f) });
  await s.push(cat(noise(500), tone(1200), noise(800), tone(900), noise(900)));
  const ok = finals.filter(f => f.audio);
  assert.equal(ok.length, 2);
  assert.ok(ok[0].startMs > 200 && ok[0].startMs < 520, 'start ' + ok[0].startMs);
  assert.equal(ok[0].scores.length, ok[0].audio.length / 512);
});

test('segmenter: 外部 VAD 打分驱动（模拟 Silero）', async () => {
  const finals = [];
  let i = 0;
  const pattern = (k) => (k >= 10 && k < 50) || (k >= 80 && k < 120) ? 0.9 : 0.05; // two stretches of 'speech'
  const vad = { prob: async () => pattern(i++), reset() {} };
  const s = new SpeechSegmenter({ vad, onFinal: f => finals.push(f) });
  await s.push(new Float32Array(512 * 150));
  assert.equal(finals.filter(f => f.audio).length, 2);
});

test('segmenter: 极短噪声不出字幕；连续语音按最大长度在低分处切开', async () => {
  const a = [];
  const s1 = new SpeechSegmenter({ onFinal: f => a.push(f) });
  await s1.push(cat(noise(300), tone(100), noise(1000)));
  assert.equal(a.filter(f => f.audio).length, 0);
  const b = [];
  const s2 = new SpeechSegmenter({ maxSegmentMs: 4000, onFinal: f => b.push(f) });
  await s2.push(cat(noise(300), tone(3000), tone(150, 0.02), tone(3000), noise(1000)));
  const ok = b.filter(f => f.audio);
  assert.ok(ok.length >= 2);
  assert.ok(ok.some(f => f.cut));
  ok.forEach(f => assert.ok(f.audio.length / R <= 4.1));
});

test('segmenter: 说话期间产生 partial；flush 吐出剩余', async () => {
  const p = [], f = [];
  const s = new SpeechSegmenter({ onPartial: x => p.push(x), onFinal: x => f.push(x) });
  await s.push(cat(noise(200), tone(3500)));
  assert.ok(p.length >= 2);
  await s.flush();
  assert.equal(f.filter(x => x.audio).length, 1);
});

test('resampler: 48k/44.1k → 16k 长度正确且跨块连续', () => {
  const r = new Resampler(48000); let n = 0;
  for (let i = 0; i < 10; i++) n += r.process(new Float32Array(480)).length;
  assert.ok(Math.abs(n - 1600) <= 1);
  const r2 = new Resampler(44100); let m = 0;
  for (let i = 0; i < 100; i++) m += r2.process(new Float32Array(441)).length;
  assert.ok(Math.abs(m - 16000) <= 2);
});

test('postprocess: Whisper 幻听只对 Whisper 生效；Parakeet 低置信度短句丢弃', () => {
  assert.equal(cleanText('ご視聴ありがとうございました', { engine: 'whisper-small' }), '');
  assert.equal(cleanText('ご視聴ありがとうございました', { engine: 'parakeet-ja', conf: 0.98 }), 'ご視聴ありがとうございました');
  assert.equal(cleanText('あっ。', { conf: 0.47 }), '');           // popping out of music
  assert.equal(cleanText('はい。', { conf: 0.95 }), 'はい。');      // a real 'はい' answer
  assert.equal(cleanText('。', { conf: 0.75 }), '');
  assert.equal(cleanText('(音楽)'), '');
  assert.equal(cleanText('今日は 雨 です'), '今日は雨です');
  assert.equal(cleanText('そうそうそうそうそうそう'), 'そう');
  assert.equal(cleanText('ぺコラです', { corrections: parsePairs('ぺコラ=ぺこら\n# 注释\n') }), 'ぺこらです');
  assert.equal(isHallucination('Thank you for watching!'), true);
});

test('postprocess: 句子完整性判断与口头禅', () => {
  assert.equal(looksIncomplete('警戒するとともに。'), true);   // Parakeet adds '。' even at the end of a half-sentence
  assert.equal(looksIncomplete('およそ100億円と。'), true);
  assert.equal(looksIncomplete('呼びかけています。'), false);
  assert.equal(looksIncomplete('聞こえてる?'), false);
  assert.equal(looksIncomplete('I went to the', 'en'), true);
  assert.equal(stripFillers('えーと、あの、今日はですね'), '今日はですね');
});

test('speaker: 不同声纹分开、相近声纹合并、短句沿用', () => {
  const rnd = (seed) => { let x = seed; return () => (x = (x * 16807) % 2147483647) / 2147483647 - 0.5; };
  const base = (seed) => { const r = rnd(seed); return Float32Array.from({ length: 192 }, r); };
  const jitter = (v, seed) => { const r = rnd(seed); return Float32Array.from(v, x => x + r() * 0.08); };
  const A = base(7), B = base(99);
  const c = new SpeakerClusterer();
  assert.equal(c.assign(jitter(A, 1), 2), 0);
  assert.equal(c.assign(jitter(B, 2), 2), 1);
  assert.equal(c.assign(jitter(A, 3), 2), 0);
  assert.equal(c.assign(jitter(B, 4), 0.6), 1);
  assert.equal(c.speakers.length, 2);
});

test('config: 场景预设、引擎选择、下载地址', () => {
  const s = applyScene(DEFAULT_SETTINGS, 'meeting');
  assert.equal(s.splitTurns, true);
  assert.equal(s.silenceMs, SCENES.meeting.silenceMs);
  assert.equal(applyScene(DEFAULT_SETTINGS, 'xx').scene, 'custom');
  assert.deepEqual(resolveEngine('auto', 'ja'), { primary: 'sensevoice', refine: ['ja'] });
  assert.deepEqual(resolveEngine('auto', 'zh'), { primary: 'sensevoice', refine: ['zh'] });
  assert.deepEqual(resolveEngine('auto', 'en'), { primary: 'sensevoice', refine: ['en'] });
  assert.deepEqual(resolveEngine('auto', 'auto'), { primary: 'sensevoice', refine: ['ja', 'zh', 'en'] });
  assert.deepEqual(resolveEngine('auto', 'ms'), { primary: 'whisper-small', refine: [] });
  assert.deepEqual(resolveEngine('parakeet-ja', 'zh'), { primary: 'sensevoice', refine: ['zh'] });
  assert.deepEqual(resolveEngine('sensevoice', 'zh'), { primary: 'sensevoice', refine: [] });
  assert.deepEqual(requiredModels({ engine: 'auto', sourceLang: 'auto', diarize: true }), ['sensevoice', 'parakeet-ja', 'zipformer-zh', 'parakeet-en', 'campplus']);
  assert.deepEqual(requiredModels({ engine: 'auto', sourceLang: 'zh', diarize: false }), ['sensevoice', 'zipformer-zh']);
  assert.deepEqual(requiredModels({ engine: 'auto', sourceLang: 'en', diarize: false }), ['sensevoice', 'parakeet-en']);
  assert.deepEqual(requiredModels({ engine: 'sensevoice', sourceLang: 'auto', diarize: false }), ['sensevoice']);
  const u = modelUrls('campplus', 'x.onnx', 'mirror');
  assert.match(u[0], /^https:\/\/hf-mirror\.com\//);
  assert.match(u[1], /^https:\/\/huggingface\.co\//);
  assert.match(u[2], /github\.com/);
});
