// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class SileroVadModelConfig {
  public String model = "";
  public float threshold = 0.5f;
  public float minSilenceDuration = 0.25f;
  public float minSpeechDuration = 0.25f;
  public int windowSize = 512;
  public float maxSpeechDuration = 5.0f;
  public SileroVadModelConfig() {}
}
