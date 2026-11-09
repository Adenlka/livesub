// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class OfflineWhisperModelConfig {
  public String encoder = "";
  public String decoder = "";
  public String language = "en";
  public String task = "transcribe";
  public int tailPaddings = 1000;
  public boolean enableTokenTimestamps = false;
  public boolean enableSegmentTimestamps = false;
  public OfflineWhisperModelConfig() {}
}
