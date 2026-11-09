// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class FeatureConfig {
  public int sampleRate = 16000;
  public int featureDim = 80;
  public float dither = 0.0f;
  public FeatureConfig() {}
}
