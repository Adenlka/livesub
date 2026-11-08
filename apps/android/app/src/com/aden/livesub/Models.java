package com.aden.livesub;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.Map;

import com.k2fsa.sherpa.onnx.OfflineModelConfig;

/** Recognition models: catalog, download (Hugging Face -> mirror) and the matching sherpa-onnx config */
public final class Models {
  private Models() {}

  public static final class Spec {
    public final String id, name, repo; public final String[] files; public final long size;
    Spec(String id, String name, String repo, long size, String... files) { this.id = id; this.name = name; this.repo = repo; this.size = size; this.files = files; }
  }

  public static final Map<String, Spec> ALL = new LinkedHashMap<String, Spec>();
  static {
    add(new Spec("sensevoice", "SenseVoice 中英日韩（0.2B）", "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17", 239000000L, "model.int8.onnx", "tokens.txt"));
    add(new Spec("parakeet-ja", "Parakeet 日语（0.6B）", "csukuangfj/sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8", 656000000L, "model.int8.onnx", "tokens.txt"));
    add(new Spec("zipformer-zh", "Zipformer 中文（精识别）", "csukuangfj/sherpa-onnx-zipformer-ctc-zh-int8-2025-07-03", 367000000L, "model.int8.onnx", "tokens.txt"));
    add(new Spec("parakeet-en", "Parakeet-TDT 英语（0.6B）", "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", 661000000L, "encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"));
    add(new Spec("zipformer-ko", "Zipformer 韩语（精识别）", "k2-fsa/sherpa-onnx-zipformer-korean-2024-06-24", 76000000L, "encoder-epoch-99-avg-1.int8.onnx", "decoder-epoch-99-avg-1.int8.onnx", "joiner-epoch-99-avg-1.int8.onnx", "tokens.txt"));
  }
  static void add(Spec s) { ALL.put(s.id, s); }

  /** Refine model for each language */
  public static String refineFor(String lang) {
    if ("ja".equals(lang)) return "parakeet-ja";
    if ("zh".equals(lang)) return "zipformer-zh";
    if ("en".equals(lang)) return "parakeet-en";
    if ("ko".equals(lang)) return "zipformer-ko";
    return null;
  }

  public static File dir(File root, String id) { return new File(new File(root, "models"), id); }

  public static boolean ready(File root, String id) {
    Spec s = ALL.get(id);
    for (String f : s.files) if (!new File(dir(root, id), f).isFile()) return false;
    return true;
  }

  public static long downloadedBytes(File root) {
    long n = 0; File m = new File(root, "models"); File[] ds = m.listFiles();
    if (ds != null) for (File d : ds) { File[] fs = d.listFiles(); if (fs != null) for (File f : fs) n += f.length(); }
    return n;
  }

  public static void deleteAll(File root) {
    File m = new File(root, "models"); File[] ds = m.listFiles();
    if (ds != null) for (File d : ds) { File[] fs = d.listFiles(); if (fs != null) for (File f : fs) f.delete(); d.delete(); }
  }

  public interface Progress { void on(String id, long done, long total); }

  /** Download missing files (resumable; Hugging Face first, hf-mirror.com as fallback) */
  public static void download(File root, String id, String host, Progress p) throws Exception {
    Spec s = ALL.get(id);
    File d = dir(root, id); d.mkdirs();
    long total = s.size, done = 0;
    for (String f : s.files) { File out = new File(d, f); if (out.isFile()) done += out.length(); }
    for (String f : s.files) {
      File out = new File(d, f);
      if (out.isFile()) continue;
      String[] hosts = "mirror".equals(host) ? new String[]{"https://hf-mirror.com", "https://huggingface.co"} : new String[]{"https://huggingface.co", "https://hf-mirror.com"};
      Exception last = null;
      for (String h : hosts) {
        try { done = fetch(h + "/" + s.repo + "/resolve/main/" + f, out, id, done, total, p); last = null; break; }
        catch (Exception e) { last = e; }
      }
      if (last != null) throw last;
    }
  }

  static long fetch(String url, File out, String id, long done, long total, Progress p) throws Exception {
    File part = new File(out.getPath() + ".part");
    long have = part.isFile() ? part.length() : 0;
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setInstanceFollowRedirects(true); c.setConnectTimeout(15000); c.setReadTimeout(30000);
    if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
    int code = c.getResponseCode();
    if (code != 200 && code != 206) throw new Exception("HTTP " + code);
    if (code == 200) have = 0;
    InputStream in = c.getInputStream();
    OutputStream o = new FileOutputStream(part, have > 0);
    byte[] buf = new byte[1 << 16]; int n; long last = 0;
    done += have;
    try {
      while ((n = in.read(buf)) > 0) {
        o.write(buf, 0, n); done += n;
        long now = System.currentTimeMillis();
        if (now - last > 300) { last = now; p.on(id, done, total); }
      }
    } finally { o.close(); in.close(); }
    if (!part.renameTo(out)) throw new Exception("rename failed");
    return done;
  }

  /** sherpa-onnx recognizer config */
  public static OfflineModelConfig config(File root, String id, int threads) {
    File d = dir(root, id);
    OfflineModelConfig c = new OfflineModelConfig();
    c.numThreads = threads;
    c.tokens = new File(d, "tokens.txt").getPath();
    if (id.equals("sensevoice")) { c.senseVoice.model = new File(d, "model.int8.onnx").getPath(); c.senseVoice.useInverseTextNormalization = true; }
    else if (id.equals("parakeet-ja")) { c.nemo.model = new File(d, "model.int8.onnx").getPath(); }
    else if (id.equals("zipformer-zh")) { c.zipformerCtc.model = new File(d, "model.int8.onnx").getPath(); }
    else if (id.equals("parakeet-en")) { c.transducer.encoder = new File(d, "encoder.int8.onnx").getPath(); c.transducer.decoder = new File(d, "decoder.int8.onnx").getPath(); c.transducer.joiner = new File(d, "joiner.int8.onnx").getPath(); c.modelType = "nemo_transducer"; }
    else if (id.equals("zipformer-ko")) { c.transducer.encoder = new File(d, "encoder-epoch-99-avg-1.int8.onnx").getPath(); c.transducer.decoder = new File(d, "decoder-epoch-99-avg-1.int8.onnx").getPath(); c.transducer.joiner = new File(d, "joiner-epoch-99-avg-1.int8.onnx").getPath(); c.modelType = "transducer"; }
    return c;
  }

  /** Copy a small file bundled in the APK (Silero VAD) */
  public static File copyAsset(android.content.Context ctx, String name) throws Exception {
    File out = new File(ctx.getFilesDir(), name);
    if (out.isFile()) return out;
    InputStream in = ctx.getAssets().open(name); OutputStream o = new FileOutputStream(out);
    byte[] b = new byte[8192]; int n; while ((n = in.read(b)) > 0) o.write(b, 0, n);
    o.close(); in.close();
    return out;
  }
}
