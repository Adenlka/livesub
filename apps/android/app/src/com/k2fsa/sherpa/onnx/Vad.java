package com.k2fsa.sherpa.onnx;

public class Vad {
  private long ptr;
  static { System.loadLibrary("sherpa-onnx-jni"); }
  public Vad(VadModelConfig config) {
    ptr = newFromFile(config);
    if (ptr == 0) throw new IllegalArgumentException("failed to create native Vad");
  }
  public void release() { if (ptr != 0) { delete(ptr); ptr = 0; } }
  /** Speech probability of one window (512 samples) */
  public float compute(float[] samples) { return compute(ptr, samples); }
  public void reset() { reset(ptr); }
  private native void delete(long ptr);
  private native long newFromFile(VadModelConfig config);
  private native void acceptWaveform(long ptr, float[] samples);
  private native float compute(long ptr, float[] samples);
  private native boolean empty(long ptr);
  private native void pop(long ptr);
  private native void clear(long ptr);
  private native SpeechSegment front(long ptr);
  private native boolean isSpeechDetected(long ptr);
  private native void reset(long ptr);
  private native void flush(long ptr);
}
