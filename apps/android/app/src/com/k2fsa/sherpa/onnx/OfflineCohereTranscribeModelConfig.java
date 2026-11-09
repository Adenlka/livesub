// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class OfflineCohereTranscribeModelConfig {
  public String encoder = "";
  public String decoder = "";
  public String language = "";
  public boolean usePunct = true;
  public boolean useItn = true;
  public OfflineCohereTranscribeModelConfig() {}
}
