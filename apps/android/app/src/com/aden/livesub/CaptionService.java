package com.aden.livesub;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;

import com.k2fsa.sherpa.onnx.Vad;
import com.k2fsa.sherpa.onnx.VadModelConfig;

/** Foreground service: capture audio (other apps' playback / microphone) -> recognize -> translate -> floating subtitles */
public class CaptionService extends Service {
  public static final String ACTION_START = "start", ACTION_STOP = "stop";
  public interface StatusListener { void onStatus(String state, String msg); void onRunning(boolean running); }
  public static volatile StatusListener listener;
  public static volatile boolean running = false;
  public static volatile String lastStatus = "";
  /** Transcript: keeps only the latest 80 lines unless 'Record subtitles' is on */
  public static final List<String> transcript = new ArrayList<String>();

  Prefs prefs; Captions caps; Overlay overlay; Translator tr; Asr asr; Segmenter seg; Vad vad;
  MediaProjection projection; AudioRecord rec; Thread audioT; volatile boolean capturing;
  final java.util.Set<String> downloading = java.util.Collections.synchronizedSet(new java.util.HashSet<String>());

  public IBinder onBind(Intent i) { return null; }

  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null || ACTION_STOP.equals(intent.getAction())) { stopAll(); stopSelf(); return START_NOT_STICKY; }
    if (running) return START_NOT_STICKY;
    I18n.load(this);
    prefs = new Prefs(this);
    boolean system = "system".equals(prefs.source);
    startFg(system);
    if (system) {
      int code = intent.getIntExtra("code", 0); Intent data = intent.getParcelableExtra("data");
      if (code != Activity.RESULT_OK || data == null) { stopSelf(); return START_NOT_STICKY; }
      projection = ((MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE)).getMediaProjection(code, data);
      if (Build.VERSION.SDK_INT >= 34) projection.registerCallback(new MediaProjection.Callback() { public void onStop() { stopAll(); stopSelf(); } }, null);
    }
    running = true; if (listener != null) listener.onRunning(true);
    new Thread(new Runnable() { public void run() { startPipeline(); } }, "start").start();
    return START_NOT_STICKY;
  }

  void startFg(boolean system) {
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    nm.createNotificationChannel(new NotificationChannel("live", "LiveSub", NotificationManager.IMPORTANCE_LOW));
    Intent stop = new Intent(this, CaptionService.class).setAction(ACTION_STOP);
    PendingIntent ps = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE);
    PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
    Notification n = new Notification.Builder(this, "live").setSmallIcon(R.drawable.ic_stat).setContentTitle(I18n.t("LiveSub live subtitles")).setContentText(I18n.t("Running"))
      .setContentIntent(open).addAction(new Notification.Action.Builder(null, I18n.t("Stop subtitles"), ps).build()).setOngoing(true).build();
    if (Build.VERSION.SDK_INT >= 29) startForeground(7, n, system ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
    else startForeground(7, n);
  }

  void status(String state, String msg) {
    lastStatus = msg;
    if (overlay != null) overlay.setStatus(msg, "loading".equals(state) ? 0 : "error".equals(state) ? 12000 : 4000);
    if (listener != null) listener.onStatus(state, msg);
  }

  void startPipeline() {
    try {
      final File root = getFilesDir();
      caps = new Captions(); caps.maxLines = prefs.maxLines; caps.display = prefs.translate ? prefs.display : "source";
      caps.sourceLang = "auto".equals(prefs.sourceLang) ? null : prefs.sourceLang; caps.targetLang = prefs.target;
      overlay = new Overlay(this, caps);
      overlay.ui.post(new Runnable() { public void run() { overlay.show(prefs); } });
      // Base model (SenseVoice, ~240MB): downloaded automatically on first use
      if (!Models.ready(root, "sensevoice")) download("sensevoice");
      if (!running) return;
      File vadFile = Models.copyAsset(this, "silero_vad.onnx");
      VadModelConfig vc = new VadModelConfig(); vc.sileroVadModelConfig.model = vadFile.getPath();
      vad = new Vad(vc);
      tr = new Translator(new Translator.Out() {
        public void result(List<Integer> keys, String text, String err) {
          caps.translation(keys, text, err, prefs.target); overlay.update();
          if (text != null) record("    → " + text);
          if (err != null) status("warn", err);
        }
      });
      tr.enabled = prefs.translate; tr.target = prefs.target; tr.engine = prefs.translator; tr.apiBase = prefs.apiBase; tr.apiKey = prefs.apiKey; tr.model = prefs.apiModel;
      tr.start();
      asr = new Asr(root, new Asr.Out() {
        public void partial(int id, String text, String lang) { if (!text.isEmpty()) { caps.partial(id, text, lang); overlay.update(); } }
        public void fin(int id, Asr.Part p, boolean cut, boolean draft) {
          boolean cont = cut || Text.looksIncomplete(p.text, p.lang);
          caps.fin(id, p.text, p.lang, cont, tr.enabled && !draft);
          overlay.update();
          if (!draft && !p.text.isEmpty()) { record(p.text); tr.add(id, p.text, p.lang, cont); }
        }
        public void status(String state, String msg) { CaptionService.this.status(state, msg); }
        public void needModel(final String id) {
          if (!downloading.add(id)) return;
          new Thread(new Runnable() { public void run() {
            try { download(id); for (String l : new String[]{"ja", "zh", "en", "ko"}) if (id.equals(Models.refineFor(l))) asr.modelReady(l); }
            catch (Exception e) { status("warn", I18n.t("Model download failed: ") + e.getMessage()); }
            finally { downloading.remove(id); }
          } }).start();
        }
      });
      asr.sourceLang = prefs.sourceLang; asr.light = "sensevoice".equals(prefs.engine);
      seg = new Segmenter(new Segmenter.Vad() { public float prob(float[] f) { return vad.compute(f); } public void reset() { vad.reset(); } }, new Segmenter.Listener() {
        public void onPartial(int id, float[] a, long s) { asr.partial(id, a, s); }
        public void onFinal(int id, float[] a, long s, long e, boolean cut) { if (a != null) asr.fin(id, a, s, e, cut); else { caps.fin(id, "", null, false, false); overlay.update(); } }
        public void onLevel(float r, boolean v) {}
      });
      seg.silenceMs = prefs.silenceMs;
      asr.start();
      startAudio();
    } catch (Exception e) { status("error", I18n.t("Failed to start: ") + e.getMessage()); }
  }

  void download(String id) throws Exception {
    final String name = I18n.t(Models.ALL.get(id).name);
    status("loading", I18n.t("Downloading {label} {a} / {b} MB", "label", name, "a", "0", "b", String.valueOf(Models.ALL.get(id).size / 1000000)));
    Models.download(getFilesDir(), id, prefs.modelHost, new Models.Progress() {
      public void on(String mid, long done, long total) { status("loading", I18n.t("Downloading {label} {a} / {b} MB", "label", name, "a", String.valueOf(done / 1000000), "b", String.valueOf(total / 1000000))); }
    });
    status("ready", I18n.t("{m} downloaded; switching automatically", "m", name));
  }

  void startAudio() {
    int sr = 16000;
    AudioFormat fmt = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(sr).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build();
    int buf = Math.max(AudioRecord.getMinBufferSize(sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), sr * 2);
    try {
      if (projection != null) {
        AudioPlaybackCaptureConfiguration cfg = new AudioPlaybackCaptureConfiguration.Builder(projection)
          .addMatchingUsage(AudioAttributes.USAGE_MEDIA).addMatchingUsage(AudioAttributes.USAGE_GAME).addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).build();
        rec = new AudioRecord.Builder().setAudioFormat(fmt).setBufferSizeInBytes(buf).setAudioPlaybackCaptureConfig(cfg).build();
      } else {
        rec = new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION).setAudioFormat(fmt).setBufferSizeInBytes(buf).build();
      }
    } catch (SecurityException e) { status("error", I18n.t("Recording permission denied")); return; }
    if (rec.getState() != AudioRecord.STATE_INITIALIZED) { status("error", I18n.t("Couldn't capture system audio")); return; }
    rec.startRecording(); capturing = true;
    status("ready", I18n.t("Listening"));
    audioT = new Thread(new Runnable() { public void run() {
      short[] b = new short[1600];
      while (capturing) {
        int n = rec.read(b, 0, b.length, AudioRecord.READ_BLOCKING);
        if (n <= 0) continue;
        float[] f = new float[n]; for (int i = 0; i < n; i++) f[i] = b[i] / 32768f;
        seg.push(f);
      }
    } }, "audio");
    audioT.start();
  }

  void record(String line) {
    synchronized (transcript) { transcript.add(line); if (!prefs.record) while (transcript.size() > 160) transcript.remove(0); }
  }

  void stopAll() {
    capturing = false;
    try { if (audioT != null) audioT.join(1000); } catch (InterruptedException e) {}
    if (rec != null) { try { rec.stop(); rec.release(); } catch (Exception e) {} rec = null; }
    if (projection != null) { MediaProjection mp = projection; projection = null; try { mp.stop(); } catch (Exception e) {} }
    final Asr a = asr; final Translator t = tr; final Vad v = vad; final Overlay o = overlay;
    asr = null; tr = null; vad = null; overlay = null;
    if (o != null) o.ui.post(new Runnable() { public void run() { o.hide(); } });
    // Releasing models can take seconds: do it on a background thread so the UI doesn't freeze
    new Thread(new Runnable() { public void run() { if (a != null) a.stop(); if (t != null) t.stop(); if (v != null) v.release(); } }).start();
    if (running) { running = false; if (listener != null) listener.onRunning(false); }
    stopForeground(STOP_FOREGROUND_REMOVE);
  }

  public void onDestroy() { stopAll(); super.onDestroy(); }

  public static void stop(Context ctx) { ctx.startService(new Intent(ctx, CaptionService.class).setAction(ACTION_STOP)); }
}
