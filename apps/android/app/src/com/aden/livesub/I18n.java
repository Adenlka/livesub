package com.aden.livesub;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;

/** UI language follows the OS (zh/ja/en/ko, otherwise English). The English text is the key; same dictionary as the desktop app. */
public final class I18n {
  private I18n() {}
  static String lang = detect(Locale.getDefault().getLanguage());
  static final Map<String, String[]> DICT = new HashMap<String, String[]>();

  public static String detect(String l) {
    l = l == null ? "" : l.toLowerCase();
    if (l.startsWith("zh")) return "zh"; if (l.startsWith("ja")) return "ja"; if (l.startsWith("ko")) return "ko";
    return "en";
  }
  public static String lang() { return lang; }

  public static void load(android.content.Context ctx) {
    lang = detect(Locale.getDefault().getLanguage());
    if (!DICT.isEmpty()) return;
    try {
      InputStream in = ctx.getAssets().open("i18n.json");
      java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
      while ((n = in.read(b)) > 0) bo.write(b, 0, n);
      in.close();
      loadJson(bo.toString("UTF-8"));
    } catch (Exception e) { /* no dictionary: show English */ }
  }
  public static void loadJson(String s) throws Exception {
    JSONObject o = new JSONObject(s);
    Iterator<String> it = o.keys();
    while (it.hasNext()) { String k = it.next(); JSONArray a = o.getJSONArray(k); DICT.put(k, new String[]{a.getString(0), a.getString(1), a.getString(2)}); }
  }

  /** t("Downloading {label} {a} / {b} MB", "label", x, "a", y, "b", z) */
  public static String t(String en, String... vars) {
    String s = en;
    if (!"en".equals(lang)) { String[] e = DICT.get(en); if (e != null) s = "zh".equals(lang) ? e[0] : "ja".equals(lang) ? e[1] : e[2]; }
    for (int i = 0; i + 1 < vars.length; i += 2) s = s.replace("{" + vars[i] + "}", vars[i + 1]);
    return s;
  }
}
