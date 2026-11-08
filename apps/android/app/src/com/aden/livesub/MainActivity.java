package com.aden.livesub;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.Switch;
import android.widget.TextView;

/** Settings and start/stop screen (built in code, no layout XML) */
public class MainActivity extends Activity {
  Prefs p; LinearLayout col; TextView status, models; Button toggle, overlayBtn;
  LinearLayout translateBox, apiBox;
  static final int REQ_CAPTURE = 1, REQ_PERM = 2;

  protected void onCreate(Bundle b) {
    super.onCreate(b);
    I18n.load(this);
    p = new Prefs(this);
    ScrollView sv = new ScrollView(this);
    col = new LinearLayout(this); col.setOrientation(LinearLayout.VERTICAL); col.setPadding(dp(16), dp(16), dp(16), dp(32));
    sv.addView(col); setContentView(sv);
    build();
    CaptionService.listener = new CaptionService.StatusListener() {
      public void onStatus(final String s, final String m) { runOnUiThread(new Runnable() { public void run() { status.setText(m); } }); }
      public void onRunning(boolean r) { runOnUiThread(new Runnable() { public void run() { refresh(); } }); }
    };
  }

  protected void onResume() { super.onResume(); refresh(); }
  protected void onDestroy() { CaptionService.listener = null; super.onDestroy(); }

  int dp(float v) { return (int) (v * getResources().getDisplayMetrics().density); }
  String t(String s) { return I18n.t(s); }

  TextView label(String s, float size, boolean bold) {
    TextView v = new TextView(this); v.setText(s); v.setTextSize(size); if (bold) v.setTypeface(Typeface.DEFAULT_BOLD);
    v.setPadding(0, dp(bold ? 14 : 4), 0, dp(4)); return v;
  }
  void section(String s) { col.addView(label(t(s), 15, true)); }
  void hint(LinearLayout parent, String s) { TextView v = label(t(s), 12, false); v.setAlpha(0.7f); parent.addView(v); }

  interface OnPick { void pick(int i); }
  Spinner spinner(LinearLayout parent, String title, String[] labels, int sel, final OnPick on) {
    parent.addView(label(t(title), 13, false));
    String[] tl = new String[labels.length]; for (int i = 0; i < labels.length; i++) tl[i] = t(labels[i]);
    Spinner s = new Spinner(this);
    s.setAdapter(new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, tl));
    s.setSelection(Math.max(0, sel));
    s.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
      public void onItemSelected(AdapterView<?> a, View v, int i, long id) { on.pick(i); p.save(); }
      public void onNothingSelected(AdapterView<?> a) {}
    });
    parent.addView(s); return s;
  }
  interface OnSeek { void seek(int v); }
  void seek(LinearLayout parent, String title, int min, int max, int val, final OnSeek on) {
    parent.addView(label(t(title), 13, false));
    SeekBar s = new SeekBar(this); s.setMax(max - min); s.setProgress(val - min);
    final int m = min;
    s.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
      public void onProgressChanged(SeekBar sb, int v, boolean user) { if (user) { on.seek(v + m); p.save(); } }
      public void onStartTrackingTouch(SeekBar sb) {}
      public void onStopTrackingTouch(SeekBar sb) {}
    });
    parent.addView(s);
  }
  interface OnText { void text(String s); }
  EditText edit(LinearLayout parent, String title, String val, boolean secret, final OnText on) {
    parent.addView(label(t(title), 13, false));
    EditText e = new EditText(this); e.setText(val); e.setSingleLine(true);
    if (secret) e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
    e.addTextChangedListener(new TextWatcher() {
      public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
      public void onTextChanged(CharSequence s, int a, int b, int c) {}
      public void afterTextChanged(Editable s) { on.text(s.toString().trim()); p.save(); }
    });
    parent.addView(e); return e;
  }
  interface OnCheck { void check(boolean b); }
  Switch sw(LinearLayout parent, String title, boolean val, final OnCheck on) {
    Switch s = new Switch(this); s.setText(t(title)); s.setChecked(val); s.setPadding(0, dp(8), 0, dp(8));
    s.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() { public void onCheckedChanged(CompoundButton b, boolean v) { on.check(v); p.save(); } });
    parent.addView(s); return s;
  }
  static int idx(String[] a, String v) { for (int i = 0; i < a.length; i++) if (a[i].equals(v)) return i; return 0; }

  void build() {
    TextView title = label(t("LiveSub 实时字幕"), 22, true); col.addView(title);
    toggle = new Button(this); toggle.setTextSize(17);
    toggle.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { if (CaptionService.running) CaptionService.stop(MainActivity.this); else start(); } });
    col.addView(toggle);
    status = label("", 13, false); col.addView(status);
    overlayBtn = new Button(this); overlayBtn.setText(t("允许显示在其他应用上层"));
    overlayBtn.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))); } });
    col.addView(overlayBtn);

    section("识别");
    final String[] srcV = {"system", "mic"};
    spinner(col, "声音来源", new String[]{"系统声音（其他 App 正在播放的声音）", "麦克风"}, idx(srcV, p.source), new OnPick() { public void pick(int i) { p.source = srcV[i]; } });
    hint(col, "有些 App（例如部分音乐/视频 App）禁止录制它们的声音，那时不会出字幕。");
    final String[] langV = {"auto", "ja", "zh", "en", "ko"};
    spinner(col, "说的语言", new String[]{"自动（中日英韩混合，逐句识别）", "日语", "中文", "英语", "韩语"}, idx(langV, p.sourceLang), new OnPick() { public void pick(int i) { p.sourceLang = langV[i]; } });
    final String[] engV = {"auto", "sensevoice"};
    spinner(col, "识别引擎", new String[]{"自动（推荐，各语言用最准的模型）", "轻量：只用 SenseVoice（约 240MB，准确率略低）"}, idx(engV, p.engine), new OnPick() { public void pick(int i) { p.engine = engV[i]; } });

    section("翻译");
    translateBox = new LinearLayout(this); translateBox.setOrientation(LinearLayout.VERTICAL);
    sw(col, "翻译", p.translate, new OnCheck() { public void check(boolean b) { p.translate = b; translateBox.setVisibility(b ? View.VISIBLE : View.GONE); } });
    col.addView(translateBox); translateBox.setVisibility(p.translate ? View.VISIBLE : View.GONE);
    final String[] tgtV = {"zh-CN", "zh-TW", "ja", "en", "ko"};
    spinner(translateBox, "翻成", new String[]{"简体中文", "繁體中文", "日本語", "English", "한국어"}, idx(tgtV, p.target), new OnPick() { public void pick(int i) { p.target = tgtV[i]; } });
    final String[] trV = {"google", "openai"};
    apiBox = new LinearLayout(this); apiBox.setOrientation(LinearLayout.VERTICAL);
    spinner(translateBox, "翻译引擎", new String[]{"Google（免费，测试用）", "大模型 API（推荐，质量最好）"}, idx(trV, p.translator), new OnPick() { public void pick(int i) { p.translator = trV[i]; apiBox.setVisibility(i == 1 ? View.VISIBLE : View.GONE); } });
    translateBox.addView(apiBox); apiBox.setVisibility("openai".equals(p.translator) ? View.VISIBLE : View.GONE);
    edit(apiBox, "API 地址", p.apiBase.isEmpty() ? "https://api.deepseek.com/v1" : p.apiBase, false, new OnText() { public void text(String s) { p.apiBase = s; } });
    edit(apiBox, "API Key", p.apiKey, true, new OnText() { public void text(String s) { p.apiKey = s; } });
    edit(apiBox, "模型 ID", p.apiModel.isEmpty() ? "deepseek-chat" : p.apiModel, false, new OnText() { public void text(String s) { p.apiModel = s; } });
    final String[] dispV = {"both", "target", "source"};
    spinner(translateBox, "显示内容", new String[]{"原文 + 译文", "只显示译文", "只显示原文"}, idx(dispV, p.display), new OnPick() { public void pick(int i) { p.display = dispV[i]; } });

    section("显示");
    spinner(col, "同时显示", new String[]{"1 句", "2 句（推荐）", "3 句"}, p.maxLines - 1, new OnPick() { public void pick(int i) { p.maxLines = i + 1; } });
    seek(col, "字号", 12, 36, (int) p.fontSize, new OnSeek() { public void seek(int v) { p.fontSize = v; } });
    seek(col, "字幕框宽度", 50, 100, p.boxWidth, new OnSeek() { public void seek(int v) { p.boxWidth = v; } });
    seek(col, "背景深浅", 0, 90, (int) (p.bgOpacity * 100), new OnSeek() { public void seek(int v) { p.bgOpacity = v / 100f; } });
    seek(col, "断句停顿", 300, 1200, p.silenceMs, new OnSeek() { public void seek(int v) { p.silenceMs = v; } });
    hint(col, "这项设置要重新开始字幕后才生效。");

    section("字幕记录");
    sw(col, "记录字幕（不开只保留最近的字幕）", p.record, new OnCheck() { public void check(boolean b) { p.record = b; } });
    LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL);
    Button exp = new Button(this); exp.setText(t("导出文本"));
    exp.setOnClickListener(new View.OnClickListener() { public void onClick(View v) {
      StringBuilder sb = new StringBuilder(); synchronized (CaptionService.transcript) { for (String l : CaptionService.transcript) sb.append(l).append('\n'); }
      if (sb.length() == 0) { status.setText(t("还没有字幕内容")); return; }
      Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, sb.toString()).putExtra(Intent.EXTRA_SUBJECT, "LiveSub");
      startActivity(Intent.createChooser(i, t("导出文本")));
    } });
    Button clr = new Button(this); clr.setText(t("清空"));
    clr.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { synchronized (CaptionService.transcript) { CaptionService.transcript.clear(); } status.setText(t("已清空")); } });
    row.addView(exp); row.addView(clr); col.addView(row);

    section("模型与存储");
    models = label("", 12, false); col.addView(models);
    hint(col, "识别模型下载一次后保存在本机，不需要联网也能识别（翻译仍需联网）。下载太慢可以在「设置 → 高级 → 模型下载源」切换到镜像。");
    final String[] hostV = {"hf", "mirror"};
    spinner(col, "模型下载源", new String[]{"Hugging Face", "hf-mirror.com 镜像"}, idx(hostV, p.modelHost), new OnPick() { public void pick(int i) { p.modelHost = hostV[i]; } });
    Button del = new Button(this); del.setText(t("删除已下载的模型"));
    del.setOnClickListener(new View.OnClickListener() { public void onClick(View v) {
      if (CaptionService.running) { status.setText(t("先停止字幕再删除模型")); return; }
      Models.deleteAll(getFilesDir()); status.setText(t("已删除下载的模型")); refresh();
    } });
    col.addView(del);
    TextView foot = label(t("拖动字幕框可以移动位置，双击回到默认位置。"), 12, false); foot.setGravity(Gravity.CENTER); foot.setAlpha(0.6f); col.addView(foot);
  }

  void refresh() {
    toggle.setText(t(CaptionService.running ? "停止字幕" : "开始字幕"));
    boolean canOverlay = Settings.canDrawOverlays(this);
    overlayBtn.setVisibility(canOverlay ? View.GONE : View.VISIBLE);
    if (!CaptionService.running && status.getText().length() == 0) status.setText(t(canOverlay ? "未开始" : "需要「显示在其他应用上层」权限才能显示字幕"));
    StringBuilder sb = new StringBuilder();
    for (Models.Spec s : Models.ALL.values()) sb.append(t(s.name)).append(": ").append(t(Models.ready(getFilesDir(), s.id) ? "已下载" : "未下载")).append('\n');
    sb.append(t("已下载的模型：{mb} MB").replace("{mb}", String.valueOf(Models.downloadedBytes(getFilesDir()) / 1000000)));
    if (!Models.ready(getFilesDir(), "sensevoice")) sb.append('\n').append(t("首次使用需要下载约 {mb}MB 模型（自动在后台完成，之后缓存在本机）。各语言的精识别模型会在第一次听到该语言时再下载。").replace("{mb}", "240"));
    models.setText(sb.toString());
  }

  void start() {
    if (!Settings.canDrawOverlays(this)) { status.setText(t("需要「显示在其他应用上层」权限才能显示字幕")); startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))); return; }
    java.util.List<String> need = new java.util.ArrayList<String>();
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO);
    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) need.add("android.permission.POST_NOTIFICATIONS");
    if (!need.isEmpty()) { requestPermissions(need.toArray(new String[0]), REQ_PERM); return; }
    if ("system".equals(p.source)) {
      MediaProjectionManager m = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
      startActivityForResult(m.createScreenCaptureIntent(), REQ_CAPTURE);
    } else startForegroundService(new Intent(this, CaptionService.class).setAction(CaptionService.ACTION_START));
    status.setText(t("启动中…"));
  }

  public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
    if (code != REQ_PERM) return;
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start();
    else status.setText(t("没有获得录音权限"));
  }

  protected void onActivityResult(int req, int code, Intent data) {
    if (req != REQ_CAPTURE) return;
    if (code != RESULT_OK || data == null) { status.setText(t("没有拿到系统声音")); return; }
    startForegroundService(new Intent(this, CaptionService.class).setAction(CaptionService.ACTION_START).putExtra("code", code).putExtra("data", data));
    moveTaskToBack(true); // go back to the video / stream that was playing
  }
}
