// Caption pipeline: audio -> segmenter -> recognition worker -> post-processing -> translation -> caption events
import { Resampler, mixToMono } from './resample.js';
import { SpeechSegmenter } from './segmenter.js';
import { Translator } from './translator.js';

export class CaptionPipeline {
  /**
   * @param {object} o
   * @param {Worker} o.worker  asr-worker instance (each platform creates its own)
   * @param {string} o.assetBase  URL prefix of the ort/ directory (ending in /)
   * @param {object} o.settings
   * @param {(c:{id:number,text:string,translation?:string,final:boolean,removed?:boolean})=>void} o.onCaption
   * @param {(s:{state:string,message:string,progress?:number})=>void} o.onStatus
   * @param {(rms:number, voiced:boolean)=>void} [o.onLevel]
   */
  constructor(o) {
    this.o = o;
    this.settings = { ...o.settings };
    this.worker = o.worker;
    this.translator = new Translator(this.settings, o.fetch);
    this.resampler = null;
    this.transcript = new Map(); // id -> {t, text, translation}
    this.offsetMs = 0;
    this.ready = false;
    this.segmenter = this._makeSegmenter();
    this.worker.onmessage = (e) => this._onWorker(e.data);
    this.worker.onerror = (e) => o.onStatus?.({ state: 'error', message: 'Worker 错误：' + (e.message ?? e) });
  }

  _makeSegmenter() {
    return new SpeechSegmenter({
      silenceMs: this.settings.silenceMs,
      maxSegmentMs: this.settings.maxSegmentMs,
      onLevel: this.o.onLevel,
      onPartial: ({ id, audio }) => {
        if (!this.ready) return;
        this.worker.postMessage({ type: 'transcribe', id, audio, final: false }, [audio.buffer]);
      },
      onFinal: ({ id, audio, startMs, endMs }) => {
        if (!audio) { this.o.onCaption({ id, text: '', final: true, removed: true }); return; }
        // Timestamps are counted in audio samples (independent of stop/pause); offsets accumulate across start/stop
        this.transcript.set(id, { t: Math.round(this.offsetMs + startMs), end: Math.round(this.offsetMs + endMs), text: '', translation: '' });
        if (!this.ready) return;
        this.worker.postMessage({ type: 'transcribe', id, audio, final: true }, [audio.buffer]);
      },
    });
  }

  start() {
    const s = this.settings;
    this.worker.postMessage({
      type: 'init', assetBase: this.o.assetBase,
      model: s.model, customModel: s.customModel, device: s.device, sourceLang: s.sourceLang,
      diarize: s.diarize, speakerThreshold: s.speakerThreshold,
    });
  }

  updateSettings(next) {
    const prev = { ...this.settings };
    Object.assign(this.settings, next);
    if (prev.sourceLang !== this.settings.sourceLang) this.worker.postMessage({ type: 'setLang', lang: this.settings.sourceLang });
    if (prev.speakerThreshold !== this.settings.speakerThreshold) this.worker.postMessage({ type: 'setSpeakerThreshold', value: this.settings.speakerThreshold });
    this.segmenter.silenceMs = this.settings.silenceMs;
    this.segmenter.maxSegmentMs = this.settings.maxSegmentMs;
  }

  /** Push a chunk of raw audio (any sample rate, any channel count) */
  pushAudio(channels, sampleRate) {
    const mono = Array.isArray(channels) ? mixToMono(channels) : channels;
    if (!this.resampler || this.resampler.inRate !== sampleRate) this.resampler = new (Resampler)(sampleRate);
    this.segmenter.push(this.resampler.process(mono));
  }

  resetSpeakers() { this.worker.postMessage({ type: 'resetSpeakers' }); }

  stop() {
    this.segmenter.flush();
    // Next start uses a new segmenter counting from 0: remember the offset so timestamps stay continuous
    this.offsetMs += this.segmenter.totalFrames * this.segmenter.frameMs + 1000;
    const nextId = this.segmenter.nextId;
    this.segmenter = this._makeSegmenter();
    this.segmenter.nextId = nextId; // Keep caption ids increasing to avoid clashing with older entries
  }

  dispose() {
    this.worker.terminate();
  }

  async _onWorker(m) {
    if (m.type === 'status') {
      if (m.state === 'ready') this.ready = true;
      this.o.onStatus?.(m);
      return;
    }
    if (m.type !== 'result') return;
    if (!m.final) {
      if (m.text) this.o.onCaption({ id: m.id, text: m.text, final: false });
      return;
    }
    if (!m.text) { this.transcript.delete(m.id); this.o.onCaption({ id: m.id, text: '', final: true, removed: true }); return; }
    const rec = this.transcript.get(m.id) ?? { t: this.offsetMs };
    rec.text = m.text;
    rec.speaker = m.speaker;
    this.transcript.set(m.id, rec);
    this.o.onCaption({ id: m.id, text: m.text, speaker: m.speaker, final: true, pendingTranslation: this.translator.enabled });
    if (this.translator.enabled) {
      const tr = await this.translator.translate(m.text);
      rec.translation = tr;
      this.o.onCaption({ id: m.id, text: m.text, speaker: m.speaker, translation: tr, final: true });
    }
  }

  exportText() {
    return [...this.transcript.values()].filter(r => r.text)
      .map(r => `[${fmt(r.t, false)}]${spkLabel(r.speaker)} ${r.text}${r.translation ? '\n           ' + r.translation : ''}`).join('\n');
  }

  exportSRT() {
    const rows = [...this.transcript.values()].filter(r => r.text);
    return rows.map((r, i) => {
      const end = Math.max(r.end ?? 0, r.t + 1200, rows[i + 1] ? Math.min(rows[i + 1].t, (r.end ?? r.t) + 800) : 0);
      return `${i + 1}\n${fmt(r.t, true)} --> ${fmt(end, true)}\n${spkLabel(r.speaker).trim()}${spkLabel(r.speaker) ? ' ' : ''}${r.text}${r.translation ? '\n' + r.translation : ''}\n`;
    }).join('\n');
  }
}

function fmt(ms, srt) {
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, x = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return srt ? `${p(h)}:${p(m)}:${p(s)},${p(x, 3)}` : `${p(h)}:${p(m)}:${p(s)}`;
}

export const speakerName = (i) => i == null ? '' : '说话人' + String.fromCharCode(65 + i);
const spkLabel = (i) => i == null ? '' : ` [${speakerName(i)}]`;
