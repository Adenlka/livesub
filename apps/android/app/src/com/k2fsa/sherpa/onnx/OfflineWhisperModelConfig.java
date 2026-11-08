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
