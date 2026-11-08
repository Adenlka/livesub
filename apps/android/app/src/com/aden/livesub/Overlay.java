package com.aden.livesub;

import java.util.List;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Floating subtitle box: fixed width, height reserved per sentence; draggable, double-tap to reset */
public class Overlay {
  final Context ctx; final WindowManager wm; final Captions caps; final Handler ui = new Handler(Looper.getMainLooper());
  LinearLayout root, box; TextView status;
  WindowManager.LayoutParams lp;
  float fontSp = 20, bg = 0.62f; int widthPct = 92; boolean added = false;
  String statusText = "", lastSig = null; long statusUntil = 0;

  public Overlay(Context ctx, Captions caps) {
    this.ctx = ctx; this.caps = caps; wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
  }

  int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.getResources().getDisplayMetrics()); }

  public void show(Prefs p) {
    fontSp = p.fontSize; bg = p.bgOpacity; widthPct = p.boxWidth;
    if (added) { relayout(); return; }
    root = new LinearLayout(ctx); root.setOrientation(LinearLayout.VERTICAL); root.setGravity(Gravity.CENTER_HORIZONTAL);
    status = new TextView(ctx); status.setTextColor(0xFFFFD27A); status.setTextSize(12); status.setPadding(dp(8), dp(2), dp(8), dp(2));
    GradientDrawable sb = new GradientDrawable(); sb.setColor(0xA6000000); sb.setCornerRadius(dp(6)); status.setBackground(sb);
    status.setVisibility(View.GONE);
    root.addView(status, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    box = new LinearLayout(ctx); box.setOrientation(LinearLayout.VERTICAL); box.setGravity(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
    box.setPadding(dp(12), dp(6), dp(12), dp(6));
    LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    blp.topMargin = dp(4);
    root.addView(box, blp);
    int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
    lp = new WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
    lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL; lp.y = p.overlayY >= 0 ? p.overlayY : dp(72);
    final Prefs prefs = p;
    root.setOnTouchListener(new View.OnTouchListener() {
      float sy, oy, sx, ox; long lastTap = 0;
      public boolean onTouch(View v, MotionEvent e) {
        switch (e.getActionMasked()) {
          case MotionEvent.ACTION_DOWN: sy = e.getRawY(); oy = lp.y; sx = e.getRawX(); ox = lp.x; return true;
          case MotionEvent.ACTION_MOVE: lp.y = (int) (oy - (e.getRawY() - sy)); lp.x = (int) (ox + (e.getRawX() - sx)); wm.updateViewLayout(root, lp); return true;
          case MotionEvent.ACTION_UP:
            long now = System.currentTimeMillis();
            if (Math.abs(e.getRawY() - sy) < dp(6) && Math.abs(e.getRawX() - sx) < dp(6)) { if (now - lastTap < 350) { lp.x = 0; lp.y = dp(72); wm.updateViewLayout(root, lp); } lastTap = now; }
            prefs.overlayY = lp.y; prefs.save(); return true;
        }
        return false;
      }
    });
    relayout();
    wm.addView(root, lp); added = true;
    tick();
  }

  void relayout() {
    lastSig = null;
    int w = ctx.getResources().getDisplayMetrics().widthPixels;
    lp.width = w * widthPct / 100;
    GradientDrawable d = new GradientDrawable(); d.setColor(Color.argb((int) (bg * 255), 0, 0, 0)); d.setCornerRadius(dp(10));
    box.setBackground(d);
    if (added) wm.updateViewLayout(root, lp);
    render();
  }

  public void setStatus(final String s, final long ms) {
    ui.post(new Runnable() { public void run() { statusText = s == null ? "" : s; statusUntil = ms > 0 ? System.currentTimeMillis() + ms : Long.MAX_VALUE; render(); } });
  }

  public void hide() { ui.removeCallbacksAndMessages(null); if (added) { try { wm.removeView(root); } catch (Exception e) {} added = false; } }

  void tick() { ui.postDelayed(new Runnable() { public void run() { render(); if (added) tick(); } }, 250); }

  public void update() { ui.post(new Runnable() { public void run() { render(); } }); }

  TextView line(String text, float sizeSp, boolean bold, int color, String lang, boolean partial) {
    TextView t = new TextView(ctx);
    int max = caps.maxChars > 0 ? caps.maxChars : Text.isCjk(lang) ? 44 : 90;
    String s = Text.tail(Text.subtitleStyle(text, lang), partial ? max * 4 / 5 : max);
    t.setText(s); t.setTextSize(sizeSp); t.setTextColor(color); t.setGravity(Gravity.CENTER);
    if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
    t.setShadowLayer(3, 0, 1, 0xFF000000);
    if (Build.VERSION.SDK_INT >= 29 && lang != null) { try { t.setTextLocale(java.util.Locale.forLanguageTag("zh".equals(Text.base(lang)) ? "zh-CN" : Text.base(lang))); } catch (Exception e) {} }
    return t;
  }

  void render() {
    if (!added) return;
    boolean showStatus = !statusText.isEmpty() && System.currentTimeMillis() < statusUntil;
    status.setVisibility(showStatus ? View.VISIBLE : View.GONE);
    if (showStatus) status.setText(statusText);
    List<Captions.Item> vis = caps.visible();
    StringBuilder sig = new StringBuilder(showStatus ? statusText : "");
    for (Captions.Item it : vis) sig.append('|').append(it.text).append('/').append(it.translation).append(it.fin).append(it.pending);
    if (sig.toString().equals(lastSig)) return;
    lastSig = sig.toString();
    box.removeAllViews();
    box.setVisibility(vis.isEmpty() ? View.GONE : View.VISIBLE);
    boolean both = "both".equals(caps.display);
    float lineH = fontSp * 1.45f;
    box.setMinimumHeight(vis.isEmpty() ? 0 : dp((both ? lineH * 1.74f : lineH) * caps.maxLines + 8));
    for (int i = 0; i < vis.size(); i++) {
      Captions.Item it = vis.get(i);
      boolean old = i < vis.size() - 1;
      LinearLayout g = new LinearLayout(ctx); g.setOrientation(LinearLayout.VERTICAL); g.setAlpha(old ? 0.7f : 1f);
      String srcLang = it.lang != null ? it.lang : caps.sourceLang, dstLang = it.tlang != null ? it.tlang : caps.targetLang;
      boolean hasTr = it.fin && !it.merged && (!it.translation.isEmpty() || it.pending);
      if (both && hasTr) {
        g.addView(line(it.text, fontSp * 0.74f, false, 0xFFE6E6E6, srcLang, false));
        g.addView(line(it.translation.isEmpty() ? "…" : it.translation, fontSp, true, it.translation.isEmpty() ? 0x88FFFFFF : 0xFFFFFFFF, dstLang, false));
      } else if ("target".equals(caps.display) && it.fin && (hasTr)) {
        g.addView(line(it.translation.isEmpty() ? "…" : it.translation, fontSp, true, 0xFFFFFFFF, dstLang, false));
      } else {
        g.addView(line(it.text, fontSp, true, it.fin ? 0xFFFFFFFF : 0xFFBFE3FF, srcLang, !it.fin));
      }
      box.addView(g);
    }
  }
}
