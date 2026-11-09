import { t } from '../../../packages/core/src/i18n.js';
// Offscreen document: capture tab audio -> keep playing the original sound -> subtitle pipeline
// The pipeline (and loaded models) survives Stop, so the next Start needs no reload
import { CaptionPipeline } from '../../../packages/core/src/pipeline.js';
import { RESTART_KEYS } from '../../../packages/core/src/settings-form.js';

let ctx = null, stream = null, node = null, pipe = null, pipeSettings = null, captureOn = false;
const base = chrome.runtime.getURL('');
const send = (m) => chrome.runtime.sendMessage(m).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;
  (async () => {
    try {
      switch (msg.type) {
        case 'start': await start(msg.streamId, msg.settings); sendResponse({ ok: true }); break;
        case 'stop': await stopCapture(); sendResponse({ ok: true }); break;
        case 'settings': {
          if (!pipe) { sendResponse({ ok: true }); break; }
          const { needsRestart } = pipe.updateSettings(msg.settings);
          if (needsRestart) send({ type: 'status', state: 'warn', message: t('This setting takes effect after restarting subtitles') });
          sendResponse({ ok: true, needsRestart });
          break;
        }
        case 'resetSpeakers': pipe?.resetSpeakers(); sendResponse({ ok: true }); break;
        case 'getTranscript': sendResponse({ rows: pipe ? [...pipe.transcript.entries()].sort((a, b) => a[0] - b[0]).map(([key, r]) => ({ key, ...r })) : [], running: captureOn, coi: self.crossOriginIsolated }); break;
        case 'export': sendResponse({ txt: pipe?.exportText() ?? '', srt: pipe?.exportSRT() ?? '', vtt: pipe?.exportVTT() ?? '' }); break;
        case 'summarize':
          try { sendResponse({ text: await pipe.summarize() }); } catch (e) { sendResponse({ error: e.message }); }
          break;
        case 'clearTranscript': pipe?.transcript.clear(); sendResponse({ ok: true }); break;
        default: sendResponse({});
      }
    } catch (e) {
      send({ type: 'status', state: 'error', message: e.message });
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

function needNewPipeline(s) {
  if (!pipe) return true;
  return [...RESTART_KEYS].some(k => pipeSettings[k] !== s[k]);
}

async function start(streamId, settings) {
  await stopCapture();
  if (needNewPipeline(settings)) {
    pipe?.dispose();
    pipe = new CaptionPipeline({
      createWorker: (n) => new Worker(base + (n === 'vad' ? 'vad-worker.js' : 'asr-worker.js'), { type: 'module' }),
      assetBase: base,
      settings,
      onCaption: (c) => send({ type: 'caption', ...c }),
      onStatus: (s) => send({ type: 'status', ...s }),
      onLevel: (rms, voiced) => send({ type: 'level', rms, voiced }),
    });
    pipeSettings = { ...settings };
    pipe.start();
  } else {
    pipe.updateSettings(settings);
    send({ type: 'status', state: 'ready', message: t('Ready (models loaded)') });
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false,
  });
  ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  src.connect(ctx.destination); // capturing a tab mutes it; route the audio back to the speakers
  await ctx.audioWorklet.addModule(base + 'capture-worklet.js');
  node = new AudioWorkletNode(ctx, 'ls-capture');
  src.connect(node);
  node.port.onmessage = (e) => { if (captureOn) pipe?.pushAudio(e.data, ctx.sampleRate); };
  captureOn = true;
  stream.getAudioTracks()[0].addEventListener('ended', () => send({ type: 'status', state: 'stopped', message: t('Audio source ended') }));
}

async function stopCapture() {
  if (!captureOn && !stream) return;
  captureOn = false;
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  node?.disconnect(); node = null;
  await ctx?.close().catch(() => {}); ctx = null;
  await pipe?.stop().catch(() => {});
}
