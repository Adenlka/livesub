// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class VadModelConfig {
  public SileroVadModelConfig sileroVadModelConfig = new SileroVadModelConfig();
  public TenVadModelConfig tenVadModelConfig = new TenVadModelConfig();
  public int sampleRate = 16000;
  public int numThreads = 1;
  public String provider = "cpu";
  public boolean debug = false;
  public VadModelConfig() {}
}
