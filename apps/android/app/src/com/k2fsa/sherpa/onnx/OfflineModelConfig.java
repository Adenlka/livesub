package com.k2fsa.sherpa.onnx;

public class OfflineModelConfig {
  public OfflineTransducerModelConfig transducer = new OfflineTransducerModelConfig();
  public OfflineParaformerModelConfig paraformer = new OfflineParaformerModelConfig();
  public OfflineWhisperModelConfig whisper = new OfflineWhisperModelConfig();
  public OfflineFireRedAsrModelConfig fireRedAsr = new OfflineFireRedAsrModelConfig();
  public OfflineMoonshineModelConfig moonshine = new OfflineMoonshineModelConfig();
  public OfflineNemoEncDecCtcModelConfig nemo = new OfflineNemoEncDecCtcModelConfig();
  public OfflineSenseVoiceModelConfig senseVoice = new OfflineSenseVoiceModelConfig();
  public OfflineDolphinModelConfig dolphin = new OfflineDolphinModelConfig();
  public OfflineZipformerCtcModelConfig zipformerCtc = new OfflineZipformerCtcModelConfig();
  public OfflineWenetCtcModelConfig wenetCtc = new OfflineWenetCtcModelConfig();
  public OfflineOmnilingualAsrCtcModelConfig omnilingual = new OfflineOmnilingualAsrCtcModelConfig();
  public OfflineMedAsrCtcModelConfig medasr = new OfflineMedAsrCtcModelConfig();
  public OfflineFunAsrNanoModelConfig funasrNano = new OfflineFunAsrNanoModelConfig();
  public OfflineQwen3AsrModelConfig qwen3Asr = new OfflineQwen3AsrModelConfig();
  public OfflineFireRedAsrCtcModelConfig fireRedAsrCtc = new OfflineFireRedAsrCtcModelConfig();
  public OfflineCanaryModelConfig canary = new OfflineCanaryModelConfig();
  public OfflineCohereTranscribeModelConfig cohereTranscribe = new OfflineCohereTranscribeModelConfig();
  public String teleSpeech = "";
  public int numThreads = 1;
  public boolean debug = false;
  public String provider = "cpu";
  public String modelType = "";
  public String tokens = "";
  public String modelingUnit = "";
  public String bpeVocab = "";
  public OfflineModelConfig() {}
}
