package com.k2fsa.sherpa.onnx;

public class OfflineSenseVoiceModelConfig {
  public String model = "";
  public String language = "";
  public boolean useInverseTextNormalization = true;
  public QnnConfig qnnConfig = new QnnConfig();
  public OfflineSenseVoiceModelConfig() {}
}
