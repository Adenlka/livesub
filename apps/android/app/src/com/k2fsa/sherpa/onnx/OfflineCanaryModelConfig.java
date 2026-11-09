// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class OfflineCanaryModelConfig {
  public String encoder = "";
  public String decoder = "";
  public String srcLang = "en";
  public String tgtLang = "en";
  public boolean usePnc = true;
  public OfflineCanaryModelConfig() {}
}
