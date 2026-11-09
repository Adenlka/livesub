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
    TextView title = label(t("LiveSub live subtitles"), 22, true); col.addView(title);
    toggle = new Button(this); toggle.setTextSize(17);
    toggle.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { if (CaptionService.running) CaptionService.stop(MainActivity.this); else start(); } });
    col.addView(toggle);
    status = label("", 13, false); col.addView(status);
    overlayBtn = new Button(this); overlayBtn.setText(t("Allow display over other apps"));
    overlayBtn.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))); } });
    col.addView(overlayBtn);

    section("Recognition");
    final String[] srcV = {"system", "mic"};
    spinner(col, "Audio source", new String[]{"System audio (sound playing in other apps)", "Microphone"}, idx(srcV, p.source), new OnPick() { public void pick(int i) { p.source = srcV[i]; } });
    hint(col, "Some apps (certain music/video apps) block audio capture; no subtitles will appear for them.");
    final String[] langV = {"auto", "ja", "zh", "en", "ko"};
    spinner(col, "Spoken language", new String[]{"Auto (zh/ja/en/ko, detected per sentence)", "Japanese", "Chinese", "English", "Korean"}, idx(langV, p.sourceLang), new OnPick() { public void pick(int i) { p.sourceLang = langV[i]; } });
    final String[] engV = {"auto", "sensevoice"};
    spinner(col, "Recognition engine", new String[]{"Auto (recommended, best model per language)", "Light: SenseVoice only (~240MB, slightly less accurate)"}, idx(engV, p.engine), new OnPick() { public void pick(int i) { p.engine = engV[i]; } });

    section("Translation");
    translateBox = new LinearLayout(this); translateBox.setOrientation(LinearLayout.VERTICAL);
    sw(col, "Translation", p.translate, new OnCheck() { public void check(boolean b) { p.translate = b; translateBox.setVisibility(b ? View.VISIBLE : View.GONE); } });
    col.addView(translateBox); translateBox.setVisibility(p.translate ? View.VISIBLE : View.GONE);
    final String[] tgtV = {"zh-CN", "zh-TW", "ja", "en", "ko"};
    spinner(translateBox, "Translate to", new String[]{"Simplified Chinese", "Traditional Chinese", "日本語", "English", "한국어"}, idx(tgtV, p.target), new OnPick() { public void pick(int i) { p.target = tgtV[i]; } });
    final String[] trV = {"google", "openai"};
    apiBox = new LinearLayout(this); apiBox.setOrientation(LinearLayout.VERTICAL);
    spinner(translateBox, "Translator", new String[]{"Google (free, for testing)", "LLM API (recommended, best quality)"}, idx(trV, p.translator), new OnPick() { public void pick(int i) { p.translator = trV[i]; apiBox.setVisibility(i == 1 ? View.VISIBLE : View.GONE); } });
    translateBox.addView(apiBox); apiBox.setVisibility("openai".equals(p.translator) ? View.VISIBLE : View.GONE);
    edit(apiBox, "API URL", p.apiBase.isEmpty() ? "https://api.deepseek.com/v1" : p.apiBase, false, new OnText() { public void text(String s) { p.apiBase = s; } });
    edit(apiBox, "API Key", p.apiKey, true, new OnText() { public void text(String s) { p.apiKey = s; } });
    edit(apiBox, "Model ID", p.apiModel.isEmpty() ? "deepseek-chat" : p.apiModel, false, new OnText() { public void text(String s) { p.apiModel = s; } });
    final String[] dispV = {"both", "target", "source"};
    spinner(translateBox, "Show", new String[]{"Original + translation", "Translation only", "Original only"}, idx(dispV, p.display), new OnPick() { public void pick(int i) { p.display = dispV[i]; } });

    section("Display");
    spinner(col, "Lines shown", new String[]{"1 sentence", "2 sentences (recommended)", "3 sentences"}, p.maxLines - 1, new OnPick() { public void pick(int i) { p.maxLines = i + 1; } });
    seek(col, "Font size", 12, 36, (int) p.fontSize, new OnSeek() { public void seek(int v) { p.fontSize = v; } });
    seek(col, "Subtitle box width", 50, 100, p.boxWidth, new OnSeek() { public void seek(int v) { p.boxWidth = v; } });
    seek(col, "Background opacity", 0, 90, (int) (p.bgOpacity * 100), new OnSeek() { public void seek(int v) { p.bgOpacity = v / 100f; } });
    seek(col, "Sentence pause", 300, 1200, p.silenceMs, new OnSeek() { public void seek(int v) { p.silenceMs = v; } });
    hint(col, "This setting takes effect after restarting subtitles.");

    section("Transcript");
    sw(col, "Record subtitles (off = only recent lines)", p.record, new OnCheck() { public void check(boolean b) { p.record = b; } });
    LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL);
    Button exp = new Button(this); exp.setText(t("Export text"));
    exp.setOnClickListener(new View.OnClickListener() { public void onClick(View v) {
      StringBuilder sb = new StringBuilder(); synchronized (CaptionService.transcript) { for (String l : CaptionService.transcript) sb.append(l).append('\n'); }
      if (sb.length() == 0) { status.setText(t("No subtitles yet")); return; }
      Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, sb.toString()).putExtra(Intent.EXTRA_SUBJECT, "LiveSub");
      startActivity(Intent.createChooser(i, t("Export text")));
    } });
    Button clr = new Button(this); clr.setText(t("Clear"));
    clr.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { synchronized (CaptionService.transcript) { CaptionService.transcript.clear(); } status.setText(t("Cleared")); } });
    row.addView(exp); row.addView(clr); col.addView(row);

    section("Models & storage");
    models = label("", 12, false); col.addView(models);
    hint(col, "Models are downloaded once and kept on this computer, so recognition works offline (translation needs internet). If downloads are slow, switch Settings → Advanced → Model source to the mirror.");
    final String[] hostV = {"hf", "mirror"};
    spinner(col, "Model source", new String[]{"Hugging Face", "hf-mirror.com mirror"}, idx(hostV, p.modelHost), new OnPick() { public void pick(int i) { p.modelHost = hostV[i]; } });
    Button del = new Button(this); del.setText(t("Delete downloaded models"));
    del.setOnClickListener(new View.OnClickListener() { public void onClick(View v) {
      if (CaptionService.running) { status.setText(t("Stop subtitles before deleting models")); return; }
      Models.deleteAll(getFilesDir()); status.setText(t("Downloaded models deleted")); refresh();
    } });
    col.addView(del);
    TextView foot = label(t("Drag the subtitle box to move it; double-tap to reset."), 12, false); foot.setGravity(Gravity.CENTER); foot.setAlpha(0.6f); col.addView(foot);
  }

  void refresh() {
    toggle.setText(t(CaptionService.running ? "Stop subtitles" : "Start subtitles"));
    boolean canOverlay = Settings.canDrawOverlays(this);
    overlayBtn.setVisibility(canOverlay ? View.GONE : View.VISIBLE);
    if (!CaptionService.running && status.getText().length() == 0) status.setText(t(canOverlay ? "Not started" : "Subtitles need the \"Display over other apps\" permission"));
    StringBuilder sb = new StringBuilder();
    for (Models.Spec s : Models.ALL.values()) sb.append(t(s.name)).append(": ").append(t(Models.ready(getFilesDir(), s.id) ? "downloaded" : "not downloaded")).append('\n');
    sb.append(t("Downloaded models: {mb} MB").replace("{mb}", String.valueOf(Models.downloadedBytes(getFilesDir()) / 1000000)));
    if (!Models.ready(getFilesDir(), "sensevoice")) sb.append('\n').append(t("First use downloads about {mb}MB of models automatically (cached afterwards). Each language's high-accuracy model is downloaded the first time that language is heard.").replace("{mb}", "240"));
    models.setText(sb.toString());
  }

  void start() {
    if (!Settings.canDrawOverlays(this)) { status.setText(t("Subtitles need the \"Display over other apps\" permission")); startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))); return; }
    java.util.List<String> need = new java.util.ArrayList<String>();
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO);
    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) need.add("android.permission.POST_NOTIFICATIONS");
    if (!need.isEmpty()) { requestPermissions(need.toArray(new String[0]), REQ_PERM); return; }
    if ("system".equals(p.source)) {
      MediaProjectionManager m = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
      startActivityForResult(m.createScreenCaptureIntent(), REQ_CAPTURE);
    } else startForegroundService(new Intent(this, CaptionService.class).setAction(CaptionService.ACTION_START));
    status.setText(t("Starting…"));
  }

  public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
    if (code != REQ_PERM) return;
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start();
    else status.setText(t("Recording permission denied"));
  }

  protected void onActivityResult(int req, int code, Intent data) {
    if (req != REQ_CAPTURE) return;
    if (code != RESULT_OK || data == null) { status.setText(t("Couldn't capture system audio")); return; }
    startForegroundService(new Intent(this, CaptionService.class).setAction(CaptionService.ACTION_START).putExtra("code", code).putExtra("data", data));
    moveTaskToBack(true); // go back to the video / stream that was playing
  }
}
