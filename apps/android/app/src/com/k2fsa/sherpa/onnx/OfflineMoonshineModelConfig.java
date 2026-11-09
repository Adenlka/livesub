// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class OfflineMoonshineModelConfig {
  public String preprocessor = "";
  public String encoder = "";
  public String uncachedDecoder = "";
  public String cachedDecoder = "";
  public String mergedDecoder = "";
  public OfflineMoonshineModelConfig() {}
}
