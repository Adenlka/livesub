// Offscreen document: get the tab's audio stream -> keep playing it to the user -> feed it to the caption pipeline
import { CaptionPipeline } from '../../../packages/core/src/pipeline.js';

let ctx = null, stream = null, pipe = null, lastLevel = 0;

const send = (m) => chrome.runtime.sendMessage(m).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  (async () => {
    try {
      if (msg.type === 'start') await start(msg.streamId, msg.settings);
      else if (msg.type === 'stop') await stop();
      else if (msg.type === 'settings') pipe?.updateSettings(msg.settings);
      else if (msg.type === 'resetSpeakers') pipe?.resetSpeakers();
      else if (msg.type === 'export') { sendResponse({ text: pipe?.exportText() ?? '', srt: pipe?.exportSRT() ?? '' }); return; }
      sendResponse({ ok: true });
    } catch (e) {
      send({ type: 'status', state: 'error', message: e.message });
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

async function start(streamId, settings) {
  await stop();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  src.connect(ctx.destination); // Capturing a tab mutes its audio, so reconnect it to the speakers here
  await ctx.audioWorklet.addModule('capture-worklet.js');
  const node = new AudioWorkletNode(ctx, 'ls-capture');
  src.connect(node);

  const worker = new Worker('asr-worker.js', { type: 'module' });
  pipe = new CaptionPipeline({
    worker,
    assetBase: chrome.runtime.getURL(''),
    settings,
    onCaption: (c) => send({ type: 'caption', ...c }),
    onStatus: (s) => send({ type: 'status', ...s }),
    onLevel: (rms, voiced) => {
      const now = performance.now();
      if (now - lastLevel > 250) { lastLevel = now; send({ type: 'level', rms, voiced }); }
    },
  });
  node.port.onmessage = (e) => pipe?.pushAudio(e.data, ctx.sampleRate);
  stream.getAudioTracks()[0].addEventListener('ended', () => send({ type: 'status', state: 'stopped', message: '音频源已结束' }));
  pipe.start();
}

async function stop() {
  pipe?.stop();
  pipe?.dispose();
  pipe = null;
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  await ctx?.close().catch(() => {});
  ctx = null;
}
