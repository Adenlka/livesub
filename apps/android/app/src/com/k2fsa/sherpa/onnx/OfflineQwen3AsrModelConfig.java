package com.k2fsa.sherpa.onnx;

public class OfflineQwen3AsrModelConfig {
  public String convFrontend = "";
  public String encoder = "";
  public String decoder = "";
  public String tokenizer = "";
  public int maxTotalLen = 512;
  public int maxNewTokens = 128;
  public float temperature = 1e-6f;
  public float topP = 0.8f;
  public int seed = 42;
  public String hotwords = "";
  public OfflineQwen3AsrModelConfig() {}
}
