package com.k2fsa.sherpa.onnx;

public class SpeechSegment {
  public final long start;
  public final float[] samples;
  public SpeechSegment(long start, float[] samples) { this.start = start; this.samples = samples; }
}
