// Java mirror of the sherpa-onnx Kotlin API (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx) for its JNI library.
package com.k2fsa.sherpa.onnx;

public class OfflineStream {
  public long ptr;
  static { System.loadLibrary("sherpa-onnx-jni"); }
  public OfflineStream(long ptr) { this.ptr = ptr; }
  public void acceptWaveform(float[] samples, int sampleRate) { acceptWaveform(ptr, samples, sampleRate); }
  public void release() { if (ptr != 0) { delete(ptr); ptr = 0; } }
  private native void acceptWaveform(long ptr, float[] samples, int sampleRate);
  private native void setOption(long ptr, String key, String value);
  private native String getOption(long ptr, String key);
  private native void delete(long ptr);
}
