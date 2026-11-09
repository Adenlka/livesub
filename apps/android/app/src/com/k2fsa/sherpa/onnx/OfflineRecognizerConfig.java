// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class OfflineRecognizerConfig {
  public FeatureConfig featConfig = new FeatureConfig();
  public OfflineModelConfig modelConfig = new OfflineModelConfig();
  public HomophoneReplacerConfig hr = new HomophoneReplacerConfig();
  public String decodingMethod = "greedy_search";
  public int maxActivePaths = 4;
  public String hotwordsFile = "";
  public float hotwordsScore = 1.5f;
  public String ruleFsts = "";
  public String ruleFars = "";
  public float blankPenalty = 0.0f;
  public OfflineCtcFstDecoderConfig ctcFstDecoderConfig = new OfflineCtcFstDecoderConfig();
  public OfflineRecognizerConfig() {}
}
