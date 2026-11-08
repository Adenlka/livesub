package com.aden.livesub;

import java.util.ArrayList;
import java.util.List;

/** Speech segmenter (port of segmenter.js): Silero VAD speech probability every 32 ms -> partial / final segments */
public class Segmenter {
  public static final int FRAME = 512;
  static final float FRAME_MS = FRAME / 16f;

  public interface Vad { float prob(float[] frame); void reset(); }
  public interface Listener {
    void onPartial(int id, float[] audio, long startMs);
    /** audio == null: too short, withdraw this segment's partial caption */
    void onFinal(int id, float[] audio, long startMs, long endMs, boolean cut);
    void onLevel(float rms, boolean voiced);
  }

  public int silenceMs = 600, minSpeechMs = 250, maxSegmentMs = 8000, partialMs = 600, preRollMs = 256;
  public float startProb = 0.5f, endProb = 0.35f;
  private final Vad vad; private final Listener l;
  private float[] carry = new float[0];
  private final List<float[]> preRoll = new ArrayList<float[]>();
  private final List<float[]> preScore = new ArrayList<float[]>();
  private List<float[]> frames = new ArrayList<float[]>();
  private List<Float> scores = new ArrayList<Float>(), energies = new ArrayList<Float>();
  private boolean inSpeech = false;
  private int silenceRun = 0, speechRun = 0; private float sinceLastPartial = 0;
  private int nextId = 1, curId = 0; private long totalFrames = 0, startFrame = 0;

  public Segmenter(Vad vad, Listener l) { this.vad = vad; this.l = l; }

  public synchronized void push(float[] samples) {
    float[] buf = samples;
    if (carry.length > 0) { buf = new float[carry.length + samples.length]; System.arraycopy(carry, 0, buf, 0, carry.length); System.arraycopy(samples, 0, buf, carry.length, samples.length); }
    int off = 0;
    for (; off + FRAME <= buf.length; off += FRAME) {
      float[] f = new float[FRAME]; System.arraycopy(buf, off, f, 0, FRAME);
      double s = 0; for (int i = 0; i < FRAME; i++) s += f[i] * f[i];
      float rms = (float) Math.sqrt(s / FRAME);
      frame(f, rms, vad.prob(f));
    }
    carry = new float[buf.length - off]; System.arraycopy(buf, off, carry, 0, carry.length);
  }

  private void frame(float[] f, float rms, float score) {
    totalFrames++;
    boolean voiced = score >= (inSpeech ? endProb : startProb);
    l.onLevel(rms, voiced);
    if (!inSpeech) {
      preRoll.add(f); preScore.add(new float[]{score, rms});
      int maxPre = (int) Math.ceil(preRollMs / FRAME_MS);
      while (preRoll.size() > maxPre) { preRoll.remove(0); preScore.remove(0); }
      speechRun = voiced ? speechRun + 1 : 0;
      if (speechRun * FRAME_MS >= 64) begin(null, null, null);
      return;
    }
    frames.add(f); scores.add(score); energies.add(rms);
    silenceRun = voiced ? 0 : silenceRun + 1;
    sinceLastPartial += FRAME_MS;
    float lenMs = frames.size() * FRAME_MS;
    if (silenceRun * FRAME_MS >= silenceMs) { end(frames.size() - Math.max(0, silenceRun - 6)); return; }
    if (lenMs >= maxSegmentMs) { forceCut(); return; }
    if (sinceLastPartial >= partialMs && lenMs >= 500) { sinceLastPartial = 0; l.onPartial(curId, concat(frames, frames.size()), (long) (startFrame * FRAME_MS)); }
  }

  private void begin(List<float[]> fr, List<Float> sc, List<Float> en) {
    inSpeech = true; curId = nextId++;
    if (fr != null) { frames = fr; scores = sc; energies = en; }
    else {
      frames = new ArrayList<float[]>(preRoll); scores = new ArrayList<Float>(); energies = new ArrayList<Float>();
      for (float[] x : preScore) { scores.add(x[0]); energies.add(x[1]); }
    }
    startFrame = totalFrames - frames.size();
    preRoll.clear(); preScore.clear(); silenceRun = 0; sinceLastPartial = 0;
  }

  private void end(int keep) {
    int voicedFrames = 0; for (float x : scores) if (x >= endProb) voicedFrames++;
    int id = curId; long startMs = (long) (startFrame * FRAME_MS), endMs = (long) (startMs + keep * FRAME_MS);
    float[] audio = concat(frames, keep);
    inSpeech = false; frames = new ArrayList<float[]>(); scores = new ArrayList<Float>(); energies = new ArrayList<Float>(); speechRun = 0;
    vad.reset();
    l.onFinal(id, voicedFrames * FRAME_MS >= minSpeechMs ? audio : null, startMs, endMs, false);
  }

  /** Max length reached: cut at the least speech-like, lowest-energy point within the last 3 seconds */
  private void forceCut() {
    int n = frames.size(), look = (int) Math.min(n - 2, Math.ceil(3000 / FRAME_MS));
    float maxE = 0; for (int i = n - look; i < n; i++) maxE = Math.max(maxE, energies.get(i));
    if (maxE == 0) maxE = 1;
    int best = n - 1; double bestV = Double.MAX_VALUE;
    for (int i = n - look; i < n - 1; i++) {
      double v = (scores.get(i - 1) + scores.get(i) + scores.get(i + 1)) / 3 + 0.5 * energies.get(i) / maxE;
      if (v < bestV) { bestV = v; best = i; }
    }
    int id = curId; long startMs = (long) (startFrame * FRAME_MS);
    float[] audio = concat(frames, best);
    List<float[]> rf = new ArrayList<float[]>(frames.subList(best, n));
    List<Float> rs = new ArrayList<Float>(scores.subList(best, n)), re = new ArrayList<Float>(energies.subList(best, n));
    l.onFinal(id, audio, startMs, (long) (startMs + best * FRAME_MS), true);
    begin(rf, rs, re);
  }

  public synchronized void flush() { if (inSpeech) end(frames.size()); }

  static float[] concat(List<float[]> fr, int count) {
    float[] out = new float[count * FRAME];
    for (int i = 0; i < count; i++) System.arraycopy(fr.get(i), 0, out, i * FRAME, FRAME);
    return out;
  }
}
