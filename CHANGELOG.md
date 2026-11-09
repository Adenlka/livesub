# Changelog

Version history of LiveSub. Git history contains a source snapshot for each version listed with a date; 0.2 and 0.3 were built and used, but their source trees were not kept.

## 0.5.1 — 2026-11-09
- Android: fix translation failing with HTTP 429 (rate limiting): requests are paced and queued sentences merged, with automatic retry.
- Public release: English codebase, PolyForm Noncommercial license, third-party notices.

## 0.5.0 — 2026-11-08 (Android)
- First Android app: Java port of the two-pass recognizer on top of the sherpa-onnx JNI library.
- Captures audio from other apps (AudioPlaybackCapture) or the microphone; floating caption window.
- Gradle-free build script (aapt2 → javac → dx → apksigner).

## 0.4.3 — 2026-11-08
- Korean recognition (Zipformer transducer) and a Korean UI.

## 0.4.2 — 2026-11-07
- Two-pass recognition: SenseVoice shows a draft immediately, and a refine model in a parallel worker replaces it in place.
- Short utterances and interjections are re-decoded in the recently dominant language.
- One fixed caption box with adjustable width/size; half-sentences joined with their continuation; translations stay in sync.
- English fillers are hidden only when the recognizer is unsure, so a real "OK"/"Yeah" is still shown.

## 0.4.1 — 2026-11-07
- UI in Chinese, Japanese and English, following the OS language.
- Fully offline by default; translation and LLM features are opt-in.
- Models download automatically in the background, per language on first use.
- Transcript recording is opt-in; speaker separation moved to Beta (off by default).
- Gemini support for LLM translation, with rate-limit pacing.

## 0.4.0 — 2026-11-07
- Replaced Whisper with SenseVoice (fast pass + language ID) and per-language refine models: Parakeet (ja/en) and Zipformer (zh).
- Silero VAD segmenter, model download manager, file → SRT on desktop, Chrome side panel.

## 0.3.0 — 2026-11-07 (source not kept)
- First move from Whisper to SenseVoice and Parakeet; hotwords/glossary; evaluation on real conversational speech.

## 0.2.0 — 2026-11-06 (source not kept)
- Accuracy and UX iteration on the Whisper-based prototype.

## 0.1.0 — 2026-11-06
- First prototype: Whisper (transformers.js) running in the browser, energy-based segmenter, Chrome extension and Electron desktop app, optional translation (Google / OpenAI-compatible), speaker colors.
