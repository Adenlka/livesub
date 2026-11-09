package com.aden.livesub;

import java.io.File;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.k2fsa.sherpa.onnx.OfflineRecognizer;
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OfflineRecognizerResult;
import com.k2fsa.sherpa.onnx.OfflineStream;

/**
 * Speech recognition (port of the desktop asr-worker.js two-pass design):
 *   pass 1: SenseVoice (fast, with language ID) -> subtitles appear immediately;
 *   pass 2: the per-language refine model (separate thread) -> replaces the text in place with a more accurate result.
 */
public class Asr {
  public static final class Part { public String text = "", lang, model; public long startMs, endMs; }
  public interface Out {
    void partial(int id, String text, String lang);
    /** draft=true: first-pass result (will be replaced later) */
    void fin(int id, Part p, boolean cut, boolean draft);
    void status(String state, String msg);
    /** A refine model needs to be downloaded (call Asr.modelReady once it is done) */
    void needModel(String id);
  }

  static final class Job { int id; float[] audio; long startMs, endMs; boolean cut, fin; Part draft; }

  private final File root; private final Out out;
  public volatile String sourceLang = "auto";
  public volatile boolean light = false;   // SenseVoice only (saves memory)
  private OfflineRecognizer sv; private OfflineRecognizerConfig svConf;
  private String svLang = "";

  private final ArrayDeque<Job> finals = new ArrayDeque<Job>();
  private Job partial = null; private long partialCooldownUntil = 0;
  private final ArrayDeque<Job> refines = new ArrayDeque<Job>();
  private final Map<String, OfflineRecognizer> fine = new java.util.concurrent.ConcurrentHashMap<String, OfflineRecognizer>();
  private volatile String wanted = null;
  private final Map<String, Long> failedAt = new HashMap<String, Long>();
  private final List<String> recent = new ArrayList<String>();
  private String streakLang = null; private int streakN = 0;
  private volatile boolean running = true;
  private Thread fastT, refineT;
  private final int cores = Runtime.getRuntime().availableProcessors();

  public Asr(File root, Out out) { this.root = root; this.out = out; }

  public void start() {
    fastT = new Thread(new Runnable() { public void run() { fastLoop(); } }, "asr-fast");
    refineT = new Thread(new Runnable() { public void run() { refineLoop(); } }, "asr-refine");
    fastT.start(); refineT.start();
  }

  public void stop() {
    running = false;
    synchronized (this) { notifyAll(); }
    synchronized (refines) { refines.notifyAll(); }
    try { if (fastT != null) fastT.join(3000); if (refineT != null) refineT.join(5000); } catch (InterruptedException e) {}
    if (sv != null) sv.release();
    for (OfflineRecognizer r : fine.values()) r.release();
    fine.clear();
  }

  // --- input ---
  public synchronized void partial(int id, float[] audio, long startMs) { Job j = new Job(); j.id = id; j.audio = audio; j.startMs = startMs; partial = j; notifyAll(); }
  public synchronized void fin(int id, float[] audio, long startMs, long endMs, boolean cut) {
    Job j = new Job(); j.id = id; j.audio = audio; j.startMs = startMs; j.endMs = endMs; j.cut = cut; j.fin = true;
    finals.add(j); if (partial != null && partial.id == id) partial = null; notifyAll();
  }
  /** Called after a model has been downloaded: try to load it right away */
  public void modelReady(String lang) { failedAt.remove(lang); want(lang); }

  // --- pass 1 ---
  private void fastLoop() {
    try {
      out.status("loading", I18n.t("Loading zh/en/ja/ko model…"));
      svConf = new OfflineRecognizerConfig();
      svConf.modelConfig = Models.config(root, "sensevoice", Math.max(1, Math.min(2, cores - 1)));
      sv = new OfflineRecognizer(svConf);
      if (!light && !"auto".equals(sourceLang) && Models.refineFor(sourceLang) != null) want(sourceLang);
      out.status("ready", I18n.t("Ready: ") + label());
    } catch (Throwable e) { out.status("error", I18n.t("Recognition error: ") + e.getMessage()); return; }
    while (running) {
      Job j;
      synchronized (this) {
        while (running && finals.isEmpty() && partial == null) { try { wait(); } catch (InterruptedException e) { return; } }
        if (!running) return;
        if (!finals.isEmpty()) j = finals.poll();
        else { j = partial; partial = null; if (System.currentTimeMillis() < partialCooldownUntil) continue; }
      }
      try { if (j.fin) doFinal(j); else doPartial(j); }
      catch (Throwable e) { out.status("warn", I18n.t("Recognition error: ") + e.getMessage()); }
    }
  }

  String label() { StringBuilder b = new StringBuilder("SenseVoice"); synchronized (fine) { for (String l : fine.keySet()) b.append(" + ").append(I18n.t(Models.ALL.get(Models.refineFor(l)).name)); } return b.toString(); }

  private String[] decodeSv(float[] a, String lang) {
    String want = lang == null || "auto".equals(lang) ? "" : lang;
    if (!want.equals(svLang)) { svConf.modelConfig.senseVoice.language = want; sv.setConfig(svConf); svLang = want; }
    OfflineStream s = sv.createStream();
    s.acceptWaveform(a, 16000); sv.decode(s);
    OfflineRecognizerResult r = sv.getResult(s); s.release();
    String l = r.lang == null ? "" : r.lang.replaceAll("[<|>]", "");
    if ("yue".equals(l)) l = "zh";
    if (l.isEmpty() || "nospeech".equals(l)) l = "auto".equals(sourceLang) ? null : sourceLang;
    return new String[]{r.text == null ? "" : r.text.trim(), l};
  }

  /** SenseVoice + language correction for short utterances */
  private String[] fast(float[] a) {
    String[] r = decodeSv(a, sourceLang);
    String dom = dominant();
    // Language ID is unreliable on short utterances (interjections, 'なんだ？', 'ぎゃー'): if one language has dominated recently, decode again in that language
    if ("auto".equals(sourceLang) && dom != null && !dom.equals(r[1]) && (a.length < 16000 * 2.5 || !isMain(r[1]))) {
      String[] f = decodeSv(a, dom);
      if (!f[0].isEmpty()) r = new String[]{f[0], dom};
    }
    return r;
  }
  static boolean isMain(String l) { return "ja".equals(l) || "zh".equals(l) || "en".equals(l) || "ko".equals(l); }

  private String dominant() {
    Map<String, Integer> c = new HashMap<String, Integer>(); String best = null; int bn = 0;
    synchronized (recent) { for (String l : recent) { int n = c.containsKey(l) ? c.get(l) + 1 : 1; c.put(l, n); if (n > bn) { bn = n; best = l; } } }
    return bn >= 5 ? best : null;
  }

  private void doPartial(Job j) {
    long t0 = System.currentTimeMillis();
    boolean longSeg = j.audio.length > 16000 * 6;
    float[] a = longSeg ? java.util.Arrays.copyOfRange(j.audio, j.audio.length - 16000 * 5, j.audio.length) : j.audio;
    String[] r = fast(a);
    String text = Text.clean(r[0], r[1]);
    if (longSeg && !text.isEmpty()) text = "…" + text;
    out.partial(j.id, text, r[1]);
    partialCooldownUntil = System.currentTimeMillis() + (long) ((System.currentTimeMillis() - t0) * 1.5);
  }

  private void doFinal(Job j) {
    String[] r = fast(j.audio);
    String lang = r[1];
    String text = Text.clean(r[0], lang);
    if (!text.isEmpty() && lang != null && j.audio.length >= 16000 * 1.2) synchronized (recent) { recent.add(lang); if (recent.size() > 8) recent.remove(0); }
    Part p = new Part(); p.text = text; p.lang = lang; p.model = "sensevoice"; p.startMs = j.startMs; p.endMs = j.endMs;
    // Auto mode: load a language's refine model after 2 consecutive sentences in it
    if ("auto".equals(sourceLang) && !light && lang != null && !text.isEmpty() && Models.refineFor(lang) != null && !fine.containsKey(lang)) {
      streakN = lang.equals(streakLang) ? streakN + 1 : 1; streakLang = lang;
      if (streakN >= 2) want(lang);
    }
    boolean canRefine = !light && !text.isEmpty() && lang != null && fine.containsKey(lang);
    if (!canRefine) { out.fin(j.id, p, j.cut, false); return; }
    out.fin(j.id, p, j.cut, true);
    j.draft = p;
    synchronized (refines) {
      refines.add(j);
      // Falling behind: finalize the oldest sentence with its first-pass text instead of refining it
      while (refines.size() > 3) { Job old = refines.poll(); out.fin(old.id, old.draft, old.cut, false); }
      refines.notifyAll();
    }
  }

  // --- pass 2 ---
  private void want(String lang) {
    if (lang == null || Models.refineFor(lang) == null) return;
    synchronized (refines) { wanted = lang; refines.notifyAll(); }
  }

  private void refineLoop() {
    while (running) {
      Job j = null; String w;
      synchronized (refines) {
        while (running && refines.isEmpty() && (wanted == null || fine.containsKey(wanted))) { try { refines.wait(); } catch (InterruptedException e) { return; } }
        if (!running) return;
        w = wanted;
        if (w != null && !fine.containsKey(w)) wanted = null; else { w = null; j = refines.poll(); }
      }
      if (w != null) { load(w); continue; }
      if (j == null) continue;
      try {
        OfflineRecognizer rec; synchronized (fine) { rec = fine.get(j.draft.lang); }
        if (rec == null) { out.fin(j.id, j.draft, j.cut, false); continue; }
        OfflineStream s = rec.createStream(); s.acceptWaveform(j.audio, 16000); rec.decode(s);
        OfflineRecognizerResult rr = rec.getResult(s); s.release();
        String raw = rr.text;
        // Korean: sherpa-onnx drops the spaces between Korean words, so rebuild them from the BPE '▁' markers
        if ("ko".equals(j.draft.lang) && rr.tokens != null && rr.tokens.length > 0) { StringBuilder kb = new StringBuilder(); for (String tk : rr.tokens) kb.append(tk); raw = kb.toString().replace('\u2581', ' ').replaceAll("\\s+", " ").trim(); }
        String lang = j.draft.lang, text = raw == null ? "" : raw.trim();
        if ("zh".equals(lang)) text = MergePunct.transfer(text, j.draft.text);
        if ("en".equals(lang)) text = EnItn.apply(text);
        text = Text.clean(text, lang);
        Part p = new Part(); p.text = text.isEmpty() ? j.draft.text : text; p.lang = lang; p.model = Models.refineFor(lang); p.startMs = j.startMs; p.endMs = j.endMs;
        out.fin(j.id, p, j.cut, false);
      } catch (Throwable e) { out.fin(j.id, j.draft, j.cut, false); }
    }
  }

  private void load(String lang) {
    String id = Models.refineFor(lang);
    Long f = failedAt.get(lang);
    if (f != null && System.currentTimeMillis() - f < 20000) return;
    if (!Models.ready(root, id)) { failedAt.put(lang, System.currentTimeMillis()); out.needModel(id); return; }
    // Multi-language mode: keep only one refine model loaded at a time to save memory
    if ("auto".equals(sourceLang)) synchronized (fine) { for (OfflineRecognizer r : fine.values()) r.release(); fine.clear(); }
    try {
      out.status("loading", I18n.t("Loading {m}…", "m", I18n.t(Models.ALL.get(id).name)));
      OfflineRecognizerConfig c = new OfflineRecognizerConfig();
      c.modelConfig = Models.config(root, id, Math.max(1, Math.min(4, cores - 2)));
      OfflineRecognizer r = new OfflineRecognizer(c);
      synchronized (fine) { fine.put(lang, r); }
      out.status("ready", I18n.t("Ready: ") + label());
    } catch (Throwable e) {
      failedAt.put(lang, System.currentTimeMillis());
      out.status("warn", I18n.t("Could not load {m}; using SenseVoice for {l}: ", "m", I18n.t(Models.ALL.get(id).name), "l", I18n.t(langName(lang))) + e.getMessage());
    }
  }

  public static String langName(String l) {
    if ("ja".equals(l)) return "Japanese"; if ("zh".equals(l)) return "Chinese"; if ("en".equals(l)) return "English"; if ("ko".equals(l)) return "Korean"; return l;
  }
}
