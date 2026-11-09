// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class OfflineRecognizerResult {
  public String text;
  public String[] tokens;
  public float[] timestamps;
  public String lang;
  public String emotion;
  public String event;
  public float[] durations;
  public int[] words = new int[0];
  public OfflineRecognizerResult() {}
  public OfflineRecognizerResult(String text, String[] tokens, float[] timestamps, String lang, String emotion, String event, float[] durations, int[] words) { this.text = text; this.tokens = tokens; this.timestamps = timestamps; this.lang = lang; this.emotion = emotion; this.event = event; this.durations = durations; this.words = words; }
}
