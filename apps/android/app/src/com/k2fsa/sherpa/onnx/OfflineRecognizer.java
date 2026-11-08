package com.k2fsa.sherpa.onnx;

public class OfflineRecognizer {
  private long ptr;
  public final OfflineRecognizerConfig config;
  static { System.loadLibrary("sherpa-onnx-jni"); }
  public OfflineRecognizer(OfflineRecognizerConfig config) {
    this.config = config;
    ptr = newFromFile(config);
    if (ptr == 0) throw new IllegalArgumentException("failed to create native OfflineRecognizer");
  }
  public void release() { if (ptr != 0) { delete(ptr); ptr = 0; } }
  public OfflineStream createStream() { return new OfflineStream(createStream(ptr)); }
  public OfflineStream createStream(String hotwords) { return new OfflineStream(createStreamWithHotwords(ptr, hotwords)); }
  public void decode(OfflineStream s) { decode(ptr, s.ptr); }
  public OfflineRecognizerResult getResult(OfflineStream s) { return getResult(s.ptr); }
  private native void delete(long ptr);
  private native long createStream(long ptr);
  private native long createStreamWithHotwords(long ptr, String hotwords);
  public void setConfig(OfflineRecognizerConfig c) { setConfig(ptr, c); }
  private native void setConfig(long ptr, OfflineRecognizerConfig config);
  private native long newFromFile(OfflineRecognizerConfig config);
  private native void decode(long ptr, long streamPtr);
  private native OfflineRecognizerResult getResult(long streamPtr);
}
