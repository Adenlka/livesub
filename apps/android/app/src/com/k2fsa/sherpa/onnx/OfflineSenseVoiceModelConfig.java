// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class OfflineSenseVoiceModelConfig {
  public String model = "";
  public String language = "";
  public boolean useInverseTextNormalization = true;
  public QnnConfig qnnConfig = new QnnConfig();
  public OfflineSenseVoiceModelConfig() {}
}
