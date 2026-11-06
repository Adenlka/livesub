import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptionPipeline } from '../packages/core/src/pipeline.js';
import { DEFAULT_SETTINGS } from '../packages/core/src/languages.js';

// Mock recognition worker: final returns fixed Japanese text, segment 2 gets a different speaker
class FakeWorker {
  constructor() { this.n = 0; this.sent = []; }
  postMessage(m) {
    this.sent.push(m);
    if (m.type === 'init') setTimeout(() => this.onmessage({ data: { type: 'status', state: 'ready', message: 'ok' } }), 0);
    if (m.type === 'transcribe') {
      const i = m.final ? this.n++ : this.n;
      setTimeout(() => this.onmessage({ data: { type: 'result', id: m.id, final: m.final, text: m.final ? ['こんにちは', '' /* filtered by the worker */, '元気です'][i] ?? '' : '…', speaker: m.final ? i % 2 : null } }), 0);
    }
  }
  terminate() {}
}

const R = 48000;
const tone = (ms) => Float32Array.from({ length: R * ms / 1000 }, (_, i) => 0.2 * Math.sin(i / 20));
const quiet = (ms) => new Float32Array(R * ms / 1000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('pipeline: 音频 → 识别 → 翻译 → 字幕事件 → 导出', async () => {
  const caps = [];
  const fetch = async (url) => ({ ok: true, json: async () => [[[decodeURIComponent(url.split('q=')[1]) === 'こんにちは' ? '你好' : '我很好']]] });
  const p = new CaptionPipeline({
    worker: new FakeWorker(), assetBase: '/', settings: { ...DEFAULT_SETTINGS }, fetch,
    onCaption: (c) => caps.push(c), onStatus: () => {},
  });
  p.start();
  await sleep(5);
  for (const chunk of [quiet(300), tone(1500), quiet(800), tone(1200), quiet(800), tone(1200), quiet(800)]) {
    for (let i = 0; i < chunk.length; i += 2048) p.pushAudio([chunk.subarray(i, i + 2048), chunk.subarray(i, i + 2048)], R);
  }
  await sleep(30);
  const finals = caps.filter(c => c.final && c.translation);
  assert.deepEqual(finals.map(c => [c.text, c.translation, c.speaker]), [['こんにちは', '你好', 0], ['元気です', '我很好', 0]]);
  assert.ok(caps.some(c => c.removed), '幻听句应被撤销');
  assert.ok(caps.some(c => !c.final), '应有临时字幕');
  const srt = p.exportSRT();
  assert.match(srt, /^1\n00:00:00,\d{3} --> 00:00:02,\d{3}\n/);
  assert.match(srt, /\n2\n00:00:04,\d{3} --> 00:00:0[56],/);
  assert.match(srt, /\[说话人A\] こんにちは\n你好/);
  assert.match(p.exportText(), /元気です/);
});
