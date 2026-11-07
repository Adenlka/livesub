// Subtitle pipeline (main thread): audio -> segmenter worker -> recognition worker -> translation -> caption events / transcript
import { Resampler, mixToMono } from './resample.js';
import { TranslationManager } from './translator.js';
import { RESTART_KEYS } from './settings-form.js';

import { speakerName } from './speaker.js';
import { t } from './i18n.js';
import { looksIncomplete } from './postprocess.js';
import { baseLang } from './lang-text.js';
export { speakerName };
const keyOf = (id, sub = 0) => id * 10 + sub;

export class CaptionPipeline {
  /**
   * @param {object} o
   * @param {(name:'asr'|'vad')=>Worker} o.createWorker
   * @param {string} o.assetBase       URL (ending in /) where ort/ and models/silero_vad.onnx live
   * @param {string} [o.localModelBase] desktop: local URL prefix of downloaded models
   * @param {object} o.settings
   * @param {Function} [o.fetch]       fetch used for translation (the desktop app routes it through the main process)
   * @param {(c:object)=>void} o.onCaption
   * @param {(s:{state:string,message:string,progress?:number})=>void} [o.onStatus]
   * @param {(rms:number, voiced:boolean)=>void} [o.onLevel]
   * @param {boolean} [o.realtime=true] false = file transcription (no partials, process as fast as possible)
   */
  constructor(o) {
    this.o = o;
    this.settings = { ...o.settings };
    this.realtime = o.realtime !== false;
    this.transcript = new Map(); // key -> {t, end, text, speaker, translation}
    this.ready = false;
    this.outstanding = 0;        // segments cut but not yet recognized
    this.resampler = null;
    this.idle = [];
    this.tm = new TranslationManager({
      settings: this.settings, fetch: o.fetch,
      onResult: (keys, text, meta) => this._onTranslation(keys, text, meta),
    });
    this.vad = o.createWorker('vad');
    this.asr = o.createWorker('asr');
    this.vad.onmessage = (e) => this._onVad(e.data);
    this.asr.onmessage = (e) => this._onAsr(e.data);
    const onErr = (w) => (e) => this._status({ state: 'error', message: t('{w}出错：', { w }) + (e.message ?? e) });
    this.vad.onerror = onErr(t('切段模块')); this.asr.onerror = onErr(t('识别模块'));
  }

  _status(s) { this.o.onStatus?.(s); }

  start() {
    const s = this.settings;
    this.vad.postMessage({ type: 'init', assetBase: this.o.assetBase, vad: s.vad, silenceMs: s.silenceMs, maxSegmentMs: s.maxSegmentMs, partialIntervalMs: this.realtime ? 600 : 1e12 });
    this.asr.postMessage({
      type: 'init', assetBase: this.o.assetBase, localModelBase: this.o.localModelBase, modelHost: s.modelHost,
      engine: s.engine, customModel: s.customModel, device: s.device, sourceLang: s.sourceLang,
      diarize: s.diarize, splitTurns: s.splitTurns, speakerThreshold: s.speakerThreshold, correctionsText: s.corrections, glossaryText: s.glossary, pageTitle: s.pageTitle ?? '', topic: s.topic ?? '', recheck: this.tm.translator.recheckOn, twoPass: this.realtime,
    });
  }

  /** @returns {{needsRestart:boolean}} */
  updateSettings(next) {
    const prev = { ...this.settings };
    Object.assign(this.settings, next);
    this.tm.settings = this.settings;
    const s = this.settings;
    this.vad.postMessage({ type: 'params', silenceMs: s.silenceMs, maxSegmentMs: s.maxSegmentMs });
    this.asr.postMessage({ type: 'config', config: { sourceLang: s.sourceLang, splitTurns: s.splitTurns, speakerThreshold: s.speakerThreshold, correctionsText: s.corrections, glossaryText: s.glossary, pageTitle: s.pageTitle ?? '', topic: s.topic ?? '', recheck: this.tm.translator.recheckOn } });
    const needsRestart = [...RESTART_KEYS].some(k => prev[k] !== s[k]);
    return { needsRestart };
  }

  /** Push a chunk of raw audio (any sample rate, any channel count) */
  pushAudio(channels, sampleRate) {
    const mono = Array.isArray(channels) ? mixToMono(channels) : channels;
    if (!this.resampler || this.resampler.inRate !== sampleRate) this.resampler = new Resampler(sampleRate);
    const out = this.resampler.process(mono);
    if (out.length) this.vad.postMessage({ type: 'audio', samples: out }, [out.buffer]);
  }

  /** Stop input and flush the last half-sentence. Resolves once all captions (including translations) are done */
  async stop() {
    await new Promise((res) => { this._flushed = res; this.vad.postMessage({ type: 'flush' }); });
    await this.whenIdle();
    await Promise.all([...(this.rechecks ?? [])]);
    await this.tm.flush();
  }

  /** Reset the timeline to zero (called before file transcription) */
  async resetTimeline() {
    await new Promise((res) => { this._flushed = res; this.vad.postMessage({ type: 'reset' }); });
    this.resampler = null;
  }

  whenIdle() {
    return this.outstanding === 0 ? Promise.resolve() : new Promise(r => this.idle.push(r));
  }

  resetSpeakers() { this.asr.postMessage({ type: 'resetSpeakers' }); }
  dispose() { this.vad.terminate(); this.asr.terminate(); }

  _onVad(m) {
    switch (m.type) {
      case 'level': this.o.onLevel?.(m.rms, m.voiced); break;
      case 'status': this._status(m); break;
      case 'flushed': this._flushed?.(); this._flushed = null; break;
      case 'partial':
        if (this.ready && this.realtime) this.asr.postMessage({ type: 'transcribe', id: m.id, audio: m.audio, startMs: m.startMs, final: false }, [m.audio.buffer]);
        break;
      case 'final':
        if (!m.audio) { this.o.onCaption({ key: keyOf(m.id), removed: true }); return; }
        this.outstanding++;
        this.transcript.set(keyOf(m.id), { t: m.startMs, end: m.endMs, text: '', pending: true });
        this.asr.postMessage({ type: 'transcribe', id: m.id, audio: m.audio, scores: m.scores, startMs: m.startMs, endMs: m.endMs, cut: m.cut, final: true }, [m.audio.buffer, m.scores.buffer]);
        break;
    }
  }

  _onAsr(m) {
    if (m.type === 'status') {
      if (m.state === 'ready') this.ready = true;
      this._status(m);
      return;
    }
    if (m.type === 'partial') {
      if (m.text) this.o.onCaption({ key: keyOf(m.id), text: m.text, final: false, lang: m.lang ?? null });
      return;
    }
    if (m.type !== 'final') return;
    if (m.draft) {
      // First-pass (fast) result: show it as a caption immediately; the refined result replaces it in place and is translated afterwards
      const base = keyOf(m.id);
      const parts = (m.parts ?? []).filter(p => p.text);
      parts.forEach((p, i) => {
        const key = base + p.sub;
        const cut = m.cut || i < parts.length - 1 && parts[i + 1].speaker === p.speaker;
        const cont = cut || looksIncomplete(p.text, baseLang(p.lang ?? this.settings.sourceLang));
        this.transcript.set(key, { t: p.startMs, end: p.endMs, text: p.text, speaker: p.speaker, conf: p.conf, translation: '', dur: p.dur, lang: p.lang ?? null, model: p.model ?? null, draft: true });
        this.o.onCaption({ key, text: p.text, final: true, draft: true, cont, speaker: p.speaker, conf: p.conf, lang: p.lang ?? null, pendingTranslation: this.tm.enabled });
      });
      if (parts.length && !parts.some(p => p.sub === 0)) this.o.onCaption({ key: base, removed: true });
      return;
    }
    this.outstanding = Math.max(0, this.outstanding - 1);
    const base = keyOf(m.id);
    this.transcript.delete(base);
    const parts = (m.parts ?? []).filter(p => p.text);
    if (!parts.length) this.o.onCaption({ key: base, removed: true });
    parts.forEach((p, i) => {
      const key = base + p.sub;
      const translating = this.tm.enabled;
      this.transcript.set(key, { t: p.startMs, end: p.endMs, text: p.text, speaker: p.speaker, conf: p.conf, unsure: !!p.unsure, translation: '', dur: p.dur, lang: p.lang ?? null, model: p.model ?? null });
      if (!this.settings.keepTranscript && this.transcript.size > 80) { const old = [...this.transcript.keys()].sort((a, b) => a - b); for (const k of old.slice(0, this.transcript.size - 80)) this.transcript.delete(k); }
      const cut = m.cut || i < parts.length - 1 && parts[i + 1].speaker === p.speaker;
      // cont: the sentence isn't finished (cut, or ends in て/けど/が...) -> joined with the next segment on screen
      const cont = cut || looksIncomplete(p.text, baseLang(p.lang ?? this.settings.sourceLang));
      this.o.onCaption({ key, text: p.text, final: true, cont, speaker: p.speaker, conf: p.conf, unsure: !!p.unsure, lang: p.lang ?? null, pendingTranslation: translating });
      if (p.unsure && p.pcm && this.tm.translator.recheckOn) {
        // Cloud recheck: an LLM re-transcribes low-confidence sentences before translation (waits a few seconds at most, then uses the local result)
        const job = this._recheck(key, p, cut, translating);
        (this.rechecks ??= new Set()).add(job); job.finally(() => this.rechecks.delete(job));
      } else if (translating) this.tm.add({ key, text: p.text, speaker: p.speaker, lang: p.lang ?? null, cut, conf: p.conf, unsure: !!p.unsure });
    });
    // If the recognizer split a segment between speakers, withdraw the original partial caption key when it is unused
    if (parts.length && !parts.some(p => p.sub === 0)) this.o.onCaption({ key: base, removed: true });
    if (this.outstanding === 0) { const r = this.idle; this.idle = []; r.forEach(f => f()); }
  }

  async _recheck(key, p, cut, translating) {
    const lang = p.lang ?? (this.settings.sourceLang === 'auto' ? null : this.settings.sourceLang);
    const r = await this.tm.translator.recheck(p.pcm, lang, p.text).catch(() => null);
    const rec = this.transcript.get(key);
    let text = p.text, unsure = true;
    if (r && rec) {
      text = r; unsure = false;
      rec.asr = rec.asr ?? rec.text; rec.text = r; rec.unsure = false; rec.rechecked = true;
      this.o.onCaption({ key, text: r, final: true, speaker: rec.speaker, conf: rec.conf, unsure: false, lang: rec.lang, pendingTranslation: translating });
    }
    if (translating) this.tm.add({ key, text, speaker: p.speaker, lang: p.lang ?? null, cut, conf: p.conf, unsure });
  }

  _onTranslation(keys, text, meta) {
    // AI proofreading: the LLM fixed recognition errors -> replace the source text with the corrected one
    if (meta.fixed && keys.length === 1) { const rec = this.transcript.get(keys[0]); if (rec) { rec.asr = rec.asr ?? rec.text; rec.text = meta.fixed; } }
    keys.forEach((key, i) => {
      const rec = this.transcript.get(key);
      const last = i === keys.length - 1;
      if (rec) { rec.translation = last ? text : ''; rec.merged = !last; rec.tlang = meta.target ?? null; }
      this.o.onCaption({ key, ...(rec ? { text: rec.text, speaker: rec.speaker, conf: rec.conf, lang: rec.lang, unsure: rec.unsure && !meta.fixed } : {}), final: true,
        translation: last ? text : '', merged: !last, tlang: meta.target ?? null, skipped: meta.skipped, translationError: last ? meta.error : undefined });
    });
    if (meta.error) this._status({ state: 'warn', message: t('翻译失败：') + t(meta.error) });
  }

  // --- export ---
  rows() { return [...this.transcript.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]).filter(r => r.text); }

  exportText() {
    return this.rows().map(r => `[${fmt(r.t)}]${r.speaker != null ? ' ' + speakerName(r.speaker) + '：' : ' '}${r.text}${r.translation ? '\n    → ' + r.translation : ''}`).join('\n');
  }

  exportSRT() { return this._subs(true); }
  exportVTT() { return 'WEBVTT\n\n' + this._subs(false); }

  _subs(srt) {
    const rows = this.rows();
    // The first half of a merged translation has none of its own: in SRT the merged translation goes on the last part
    return rows.map((r, i) => {
      // end time: 0.8 s after speech ends (at least 1.2 s on screen), without overlapping the next cue
      let end = Math.max((r.end ?? r.t) + 800, r.t + 1200);
      if (rows[i + 1]) end = Math.max(r.t + 300, Math.min(end, rows[i + 1].t));
      const who = r.speaker != null && this.settings.showSpeaker ? `[${speakerName(r.speaker)}] ` : '';
      return `${srt ? i + 1 + '\n' : ''}${fmt(r.t, srt ? ',' : '.')} --> ${fmt(end, srt ? ',' : '.')}\n${who}${r.text}${r.translation ? '\n' + r.translation : ''}\n`;
    }).join('\n');
  }

  async summarize() { return this.tm.summarize(this.exportText()); }
}

function fmt(ms, sep) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, x = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return sep ? `${p(h)}:${p(m)}:${p(s)}${sep}${p(x, 3)}` : `${p(h)}:${p(m)}:${p(s)}`;
}
