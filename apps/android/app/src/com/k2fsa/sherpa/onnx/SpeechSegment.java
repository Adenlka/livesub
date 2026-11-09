// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class SpeechSegment {
  public final long start;
  public final float[] samples;
  public SpeechSegment(long start, float[] samples) { this.start = start; this.samples = samples; }
}
