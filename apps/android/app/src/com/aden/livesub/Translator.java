package com.aden.livesub;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;

/** Translation (off by default; goes online only when enabled): Google's free endpoint or any OpenAI-compatible LLM API */
public class Translator {
  public interface Out { void result(List<Integer> keys, String text, String err); }

  public static final class Item { int key; String text, lang; boolean cont; long at; }

  public volatile boolean enabled = false;
  public volatile String target = "zh-CN", engine = "google", apiBase = "", apiKey = "", model = "";
  public volatile int holdMs = 1200;
  private final Out out;
  private final ArrayDeque<Item> q = new ArrayDeque<Item>();
  private final Map<String, String> cache = new HashMap<String, String>();
  private final List<String[]> history = new ArrayList<String[]>();
  private volatile boolean running = true;
  private volatile long llmCoolUntil = 0, coolUntil = 0, backoff = 0, lastRateMsg = 0, lastGoogleAt = 0;
  private int googleHost = 0;
  static final class RateLimited extends Exception { RateLimited() { super("429"); } }
  static boolean sameLang(String a, String b) { return a == null ? b == null : a.equals(b); }
  private Thread th;

  public Translator(Out out) { this.out = out; }

  public void start() { th = new Thread(new Runnable() { public void run() { loop(); } }, "translate"); th.start(); }
  public void stop() { running = false; synchronized (q) { q.notifyAll(); } }

  public void add(int key, String text, String lang, boolean cont) {
    if (!enabled || text.isEmpty()) return;
    Item it = new Item(); it.key = key; it.text = text; it.lang = lang; it.cont = cont; it.at = System.currentTimeMillis();
    synchronized (q) { q.add(it); q.notifyAll(); }
  }

  private void loop() {
    while (running) {
      List<Item> group = new ArrayList<Item>();
      synchronized (q) {
        while (running && q.isEmpty()) { try { q.wait(); } catch (InterruptedException e) { return; } }
        if (!running) return;
        // Unfinished half-sentence: wait for the next segment (up to holdMs) and translate the whole sentence
        Item first = q.peek();
        long wait = first.at + holdMs - System.currentTimeMillis();
        if (first.cont && q.size() == 1 && wait > 0) { try { q.wait(wait); } catch (InterruptedException e) { return; } continue; }
        // Rate-limit cooldown: wait; new sentences keep queuing and are merged into one request afterwards
        long cool = coolUntil - System.currentTimeMillis();
        if (cool > 0) { try { q.wait(cool); } catch (InterruptedException e) { return; } continue; }
        int chars = 0; boolean backlog = q.size() > 1;
        while (!q.isEmpty()) {
          Item it = q.poll(); group.add(it); chars += it.text.length();
          if (chars > 300 || q.isEmpty()) break;
          if (!it.cont && !backlog) break;
          if (backlog && !sameLang(it.lang, q.peek().lang)) break;
        }
      }
      StringBuilder src = new StringBuilder(); List<Integer> keys = new ArrayList<Integer>(); String lang = group.get(0).lang;
      for (Item it : group) { if (src.length() > 0 && !Text.isCjk(lang)) src.append(' '); src.append(it.text); keys.add(it.key); }
      String s = src.toString();
      if (lang != null && Text.base(lang).equals(Text.base(target))) { out.result(keys, null, null); continue; } // already in the target language
      try {
        String r = translate(s, lang);
        backoff = 0; out.result(keys, r, null);
      } catch (RateLimited e) {
        // Rate limited: back off (5 s doubling up to 60 s), put this batch back at the front, merge it with new sentences after the cooldown
        backoff = backoff == 0 ? 5000 : Math.min(60000, backoff * 2);
        coolUntil = System.currentTimeMillis() + backoff;
        synchronized (q) { for (int i = group.size() - 1; i >= 0; i--) q.addFirst(group.get(i)); }
        if (System.currentTimeMillis() - lastRateMsg > 30000) { lastRateMsg = System.currentTimeMillis(); out.result(new ArrayList<Integer>(), null, I18n.t("翻译接口限流，{s} 秒后自动重试（期间的句子会合并翻译）", "s", String.valueOf(backoff / 1000))); }
      } catch (Exception e) { out.result(keys, null, I18n.t("翻译失败：") + e.getMessage()); }
    }
  }

  public String translate(String text, String src) throws Exception {
    String key = target + "|" + text;
    synchronized (cache) { if (cache.containsKey(key)) return cache.get(key); }
    String r = null;
    if ("openai".equals(engine) && !apiKey.isEmpty() && System.currentTimeMillis() > llmCoolUntil) {
      try { r = openai(text, src); }
      catch (RateLimited e) { llmCoolUntil = System.currentTimeMillis() + 60000; r = null; } // LLM rate limited: use Google for the next minute
      catch (Exception e) { r = null; } // LLM error -> fall back to Google
    }
    if (r == null || r.isEmpty()) r = google(text, src);
    synchronized (cache) { if (cache.size() > 500) cache.clear(); cache.put(key, r); }
    return r;
  }

  static String http(String url, String body, Map<String, String> headers) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setConnectTimeout(8000); c.setReadTimeout(15000);
    if (headers != null) for (Map.Entry<String, String> h : headers.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
    if (body != null) { c.setRequestMethod("POST"); c.setDoOutput(true); OutputStream o = c.getOutputStream(); o.write(body.getBytes("UTF-8")); o.close(); }
    int code = c.getResponseCode();
    InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
    ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[8192]; int n;
    while (in != null && (n = in.read(buf)) > 0) b.write(buf, 0, n);
    String s = b.toString("UTF-8");
    if (code == 429 || code == 503) throw new RateLimited();
    if (code >= 400) throw new Exception("HTTP " + code);
    return s;
  }

  /** Google free endpoints: rotate between two hosts, at least 0.8 s between requests (denser traffic gets rate limited) */
  String google(String text, String src) throws Exception {
    long gap = lastGoogleAt + 800 - System.currentTimeMillis();
    if (gap > 0) Thread.sleep(gap);
    lastGoogleAt = System.currentTimeMillis();
    String sl = src == null ? "auto" : Text.base(src);
    String q = URLEncoder.encode(text, "UTF-8");
    RateLimited last = null;
    for (int k = 0; k < 2; k++) {
      int h = (googleHost + k) % 2;
      try {
        String r;
        if (h == 0) {
          JSONArray a = new JSONArray(http("https://translate.googleapis.com/translate_a/single?client=gtx&sl=" + sl + "&tl=" + target + "&dt=t&q=" + q, null, null)).getJSONArray(0);
          StringBuilder sb = new StringBuilder();
          for (int i = 0; i < a.length(); i++) sb.append(a.getJSONArray(i).optString(0, ""));
          r = sb.toString().trim();
        } else {
          // Fallback host (separate quota): returns ["text"] or [["text","srcLang"]]
          JSONArray a = new JSONArray(http("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=" + sl + "&tl=" + target + "&q=" + q, null, null));
          Object first = a.get(0);
          r = (first instanceof JSONArray ? ((JSONArray) first).optString(0, "") : String.valueOf(first)).trim();
        }
        googleHost = h;
        return r;
      } catch (RateLimited e) { last = e; }
    }
    throw last;
  }

  String openai(String text, String src) throws Exception {
    JSONObject req = new JSONObject();
    req.put("model", model.isEmpty() ? "deepseek-chat" : model);
    req.put("temperature", 0.2);
    JSONArray msgs = new JSONArray();
    msgs.put(new JSONObject().put("role", "system").put("content", Prompts.system(src, target)));
    synchronized (history) {
      for (String[] h : history) { msgs.put(new JSONObject().put("role", "user").put("content", h[0])); msgs.put(new JSONObject().put("role", "assistant").put("content", h[1])); }
    }
    msgs.put(new JSONObject().put("role", "user").put("content", text));
    req.put("messages", msgs);
    if (model.matches("gemini-[\\d.]+-flash")) req.put("reasoning_effort", "low");
    Map<String, String> h = new HashMap<String, String>();
    h.put("Content-Type", "application/json"); h.put("Authorization", "Bearer " + apiKey);
    String base = apiBase.isEmpty() ? "https://api.deepseek.com/v1" : apiBase.replaceAll("/+$", "");
    JSONObject r = new JSONObject(http(base + "/chat/completions", req.toString(), h));
    String out = r.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content").trim();
    out = out.replaceAll("^(译文|翻訳|Translation)[：:]\\s*", "").replaceAll("（注：[^）]*）|\\(注：[^)]*\\)", "").trim();
    synchronized (history) { history.add(new String[]{text, out}); while (history.size() > 4) history.remove(0); }
    return out;
  }
}
