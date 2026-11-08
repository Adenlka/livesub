package com.aden.livesub;

import android.content.Context;
import android.content.SharedPreferences;

/** Settings (defaults: fully offline, auto language detection, transcript not saved) */
public class Prefs {
  final SharedPreferences sp;
  public String source = "system", sourceLang = "auto", engine = "auto", target, translator = "google", apiBase = "", apiKey = "", apiModel = "", display = "both", modelHost = "hf";
  public boolean translate = false, record = false;
  public int maxLines = 2, boxWidth = 92, overlayY = -1, silenceMs = 600;
  public float fontSize = 20, bgOpacity = 0.62f;

  public Prefs(Context ctx) {
    sp = ctx.getSharedPreferences("livesub", Context.MODE_PRIVATE);
    String ui = I18n.lang();
    target = sp.getString("target", "ja".equals(ui) ? "ja" : "ko".equals(ui) ? "ko" : "en".equals(ui) ? "en" : "zh-CN");
    source = sp.getString("source", source); sourceLang = sp.getString("sourceLang", sourceLang); engine = sp.getString("engine", engine);
    translator = sp.getString("translator", translator); apiBase = sp.getString("apiBase", apiBase); apiKey = sp.getString("apiKey", apiKey); apiModel = sp.getString("apiModel", apiModel);
    display = sp.getString("display", display); modelHost = sp.getString("modelHost", modelHost);
    translate = sp.getBoolean("translate", translate); record = sp.getBoolean("record", record);
    maxLines = sp.getInt("maxLines", maxLines); boxWidth = sp.getInt("boxWidth", boxWidth); overlayY = sp.getInt("overlayY", overlayY); silenceMs = sp.getInt("silenceMs", silenceMs);
    fontSize = sp.getFloat("fontSize", fontSize); bgOpacity = sp.getFloat("bgOpacity", bgOpacity);
  }
  public void save() {
    sp.edit().putString("target", target).putString("source", source).putString("sourceLang", sourceLang).putString("engine", engine)
      .putString("translator", translator).putString("apiBase", apiBase).putString("apiKey", apiKey).putString("apiModel", apiModel)
      .putString("display", display).putString("modelHost", modelHost).putBoolean("translate", translate).putBoolean("record", record)
      .putInt("maxLines", maxLines).putInt("boxWidth", boxWidth).putInt("overlayY", overlayY).putInt("silenceMs", silenceMs)
      .putFloat("fontSize", fontSize).putFloat("bgOpacity", bgOpacity).apply();
  }
}
