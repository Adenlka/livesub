package com.aden.livesub;

import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;

/** Caption state (same rules as the desktop caption-view.js): unfinished half-sentences are joined into one line; the previous translation stays visible for a few seconds */
public class Captions {
  public static final class Item {
    public String text = "", lang, tlang, translation = "";
    public boolean fin, cont, pending, merged, err;
    public long ts, trTs;
  }
  public static final long OLD_TTL = 6000, MIN_TR_MS = 3500, CLEAR_MS = 15000;

  final TreeMap<Integer, Item> items = new TreeMap<Integer, Item>();
  public int maxLines = 2, maxChars = 0;
  public String display = "both", sourceLang = null, targetLang = null;
  public long lastUpdate = 0;

  public synchronized void partial(int key, String text, String lang) {
    Item it = get(key); if (it.fin) return;
    it.text = text; it.lang = lang; it.ts = now(); touch();
  }
  public synchronized void fin(int key, String text, String lang, boolean cont, boolean pendingTr) {
    if (text.isEmpty()) { items.remove(key); touch(); return; }
    Item it = get(key); it.text = text; it.lang = lang; it.fin = true; it.cont = cont; it.ts = now();
    if (pendingTr && it.translation.isEmpty()) it.pending = true;
    touch();
  }
  public synchronized void translation(List<Integer> keys, String text, String err, String tlang) {
    for (int i = 0; i < keys.size(); i++) {
      Item it = items.get(keys.get(i)); if (it == null) continue;
      boolean last = i == keys.size() - 1;
      it.pending = false; it.merged = !last && text != null; it.tlang = tlang;
      if (last) { it.translation = text == null ? "" : text; it.err = err != null; it.trTs = now(); it.ts = now(); }
    }
    touch();
  }
  public synchronized void clear() { items.clear(); touch(); }

  Item get(int key) { Item it = items.get(key); if (it == null) { it = new Item(); items.put(key, it); } while (items.size() > 12) items.remove(items.firstKey()); return it; }
  void touch() { lastUpdate = now(); }
  static long now() { return System.currentTimeMillis(); }

  /** Merge items into display groups */
  synchronized List<Item> groups() {
    List<Item> out = new ArrayList<Item>();
    List<List<Item>> gs = new ArrayList<List<Item>>();
    for (Item it : items.values()) {
      if (it.text.isEmpty()) continue;
      List<Item> g = gs.isEmpty() ? null : gs.get(gs.size() - 1);
      Item last = g == null ? null : g.get(g.size() - 1);
      int len = 0; if (g != null) for (Item x : g) len += Text.len(x.text);
      int cap = maxChars > 0 ? maxChars : Text.isCjk(it.lang != null ? it.lang : sourceLang) ? 44 : 90;
      boolean open = last != null && last.fin && (last.cont || last.merged);
      if (g != null && open && g.size() < 3 && len + Text.len(it.text) <= cap && now() - last.ts < 8000) g.add(it);
      else { g = new ArrayList<Item>(); g.add(it); gs.add(g); }
    }
    for (List<Item> g : gs) {
      if (g.size() == 1) { out.add(g.get(0)); continue; }
      Item m = new Item(); Item last = g.get(g.size() - 1);
      String lang = null, tlang = null; for (Item x : g) { if (lang == null) lang = x.lang; if (tlang == null) tlang = x.tlang; }
      boolean cjk = Text.isCjk(lang != null ? lang : sourceLang), tcjk = Text.isCjk(tlang != null ? tlang : targetLang);
      StringBuilder t = new StringBuilder(), tr = new StringBuilder();
      m.fin = true;
      for (Item x : g) {
        if (t.length() > 0 && !cjk) t.append(' ');
        t.append(cjk ? x.text.replaceAll("[。．]$", "") : x.text);
        if (!x.translation.isEmpty()) { if (tr.length() > 0 && !tcjk) tr.append(' '); tr.append(x.translation); }
        m.fin &= x.fin; m.pending |= x.pending && x.translation.isEmpty() && !x.merged;
        m.ts = Math.max(m.ts, x.ts); m.trTs = Math.max(m.trTs, x.trTs);
      }
      m.text = t.toString(); m.translation = tr.toString(); m.lang = lang; m.tlang = tlang; m.err = last.err; m.cont = last.cont;
      out.add(m);
    }
    return out;
  }

  /** Items to show right now */
  public synchronized List<Item> visible() {
    List<Item> all = groups();
    if (now() - lastUpdate > CLEAR_MS) return new ArrayList<Item>();
    List<Item> list = new ArrayList<Item>();
    for (Item it : all) if (!("target".equals(display) && (it.merged || !it.fin))) list.add(it);
    while (list.size() > maxLines) list.remove(0);
    List<Item> out = new ArrayList<Item>();
    long n = now();
    for (int i = 0; i < list.size(); i++) { Item it = list.get(i); if (i == list.size() - 1 || !it.fin || n - it.ts < OLD_TTL) out.add(it); }
    if (!"source".equals(display)) {
      boolean hasTr = false; for (Item it : out) if (!it.translation.isEmpty()) hasTr = true;
      if (!hasTr) {
        Item lastTr = null; for (Item it : all) if (it.fin && !it.translation.isEmpty()) lastTr = it;
        if (lastTr != null && n - lastTr.trTs < MIN_TR_MS && !out.contains(lastTr)) out.add(0, lastTr);
      }
    }
    return out;
  }
}
