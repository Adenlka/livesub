import { setUiLang as __ui } from '../packages/core/src/i18n.js'; __ui('zh');
import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptionPipeline } from '../packages/core/src/pipeline.js';
import { DEFAULT_SETTINGS } from '../packages/core/src/config.js';

// Mock workers: vad cuts a segment after a fixed amount of audio; asr returns fixed text (segment 2 split between two speakers)
class FakeVad {
  constructor() { this.n = 0; this.buf = 0; this.t = 0; }
  postMessage(m) {
    if (m.type === 'audio') {
      this.buf += m.samples.length;
      if (this.buf >= 16000 * 2) {
        const id = ++this.n; const audio = new Float32Array(this.buf); const scores = new Float32Array(this.buf / 512 | 0);
        const startMs = this.t; this.t += this.buf / 16; this.buf = 0; const endMs = this.t;
        queueMicrotask(() => this.onmessage({ data: { type: 'final', id, audio, scores, startMs, endMs, cut: id === 1 } }));
      }
    }
    if (m.type === 'flush') queueMicrotask(() => this.onmessage({ data: { type: 'flushed' } }));
  }
  terminate() {}
}
class FakeAsr {
  postMessage(m) {
    if (m.type === 'init') setTimeout(() => this.onmessage({ data: { type: 'status', state: 'ready', message: 'ok' } }), 0);
    if (m.type === 'transcribe' && m.final) {
      const parts = m.id === 1 ? [{ sub: 0, text: '気象庁は警戒するとともに。', conf: 0.99, speaker: 0, startMs: m.startMs, endMs: m.endMs }]
        : m.id === 2 ? [{ sub: 0, text: '雪崩に注意してください。', conf: 0.98, speaker: 0, startMs: m.startMs, endMs: m.startMs + 1000 },
                        { sub: 1, text: 'はい、わかりました。', conf: 0.97, speaker: 1, startMs: m.startMs + 1000, endMs: m.endMs }]
        : [{ sub: 0, text: '', conf: 0.3, speaker: null }];
      setTimeout(() => this.onmessage({ data: { type: 'final', id: m.id, cut: m.cut, parts } }), 5);
    }
  }
  terminate() {}
}

test('pipeline: 切段 → 识别（含拆人）→ 合并翻译 → 字幕事件 → 导出', async () => {
  const caps = [];
  const fetch = async (url) => {
    const q = decodeURIComponent(url.split('q=')[1]);
    const map = { '気象庁は警戒するとともに雪崩に注意してください。': '气象厅提醒大家注意雪崩。', 'はい、わかりました。': '好的，明白了。' };
    return { ok: true, json: async () => [[[map[q] ?? '??']]] };
  };
  const p = new CaptionPipeline({
    createWorker: (n) => n === 'vad' ? new FakeVad() : new FakeAsr(),
    assetBase: '/', settings: { ...DEFAULT_SETTINGS, translate: true, targetLang: "zh-CN", translateHoldMs: 300 }, fetch,
    onCaption: (c) => caps.push(c),
  });
  p.start();
  await new Promise(r => setTimeout(r, 5));
  for (let i = 0; i < 6; i++) p.pushAudio([new Float32Array(48000 / 2 * 2), new Float32Array(48000)], 48000); // 6 s of 48 kHz stereo
  await p.stop();
  const tr = caps.filter(c => c.translation);
  assert.deepEqual(tr.map(c => [c.key, c.translation]), [[20, '气象厅提醒大家注意雪崩。'], [21, '好的，明白了。']]);
  assert.ok(caps.some(c => c.key === 10 && c.merged), '前半句标记为已合并');
  assert.ok(caps.some(c => c.key === 30 && c.removed), '空结果撤销');
  const srt = p.exportSRT();
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,000\n\[说话人A\] 気象庁は警戒するとともに。\n\n2\n00:00:02,000 --> 00:00:03,000\n/);
  assert.match(srt, /\[说话人B\] はい、わかりました。\n好的，明白了。/);
  assert.match(p.exportText(), /说话人B：はい、わかりました。\n    → 好的，明白了。/);
  assert.match(p.exportVTT(), /^WEBVTT\n\n00:00:00\.000 -->/);
});
