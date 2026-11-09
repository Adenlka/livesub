# LiveSub

**On-device live subtitles and translation for anything that plays sound** — videos, live streams, online classes and meetings.
Speech recognition runs locally (no audio leaves your device). Japanese-first, with Chinese, English and Korean support.

| Platform | What it captures | Status |
|---|---|---|
| Windows desktop (Electron) | System audio, microphone, or both; local video/audio files → SRT | v0.4.3 |
| Chrome extension (MV3) | Audio of the current tab | v0.4.3 |
| Android (10+, arm64) | Audio played by other apps, or the microphone | v0.5.1, early |

## Features

- **Two-pass recognition, low latency.** A fast multilingual model (SenseVoice) shows text about 0.5 s after someone starts speaking. A language-specific model then re-recognizes the sentence in a parallel worker and replaces the text in place. If the CPU falls behind, the oldest sentence keeps its fast result, so subtitles never drift further behind.
- **Automatic language detection per sentence** (zh / ja / en / ko). Short interjections are re-decoded in the language that has dominated recently, so 「なんだ？」 doesn't turn into English.
- **Readable subtitles.** One fixed-size box with adjustable width, font size and line count. Half-sentences are joined with their continuation, and a translation stays on screen long enough to be read.
- **Fully offline by default.** No network calls and no API usage. Translation is opt-in: Google's free endpoint, or any OpenAI-compatible LLM (DeepSeek, OpenAI, Gemini, local Ollama).
- **LLM extras (opt-in).** Context-aware proofreading of recognition errors, glossary/hotwords, a cloud re-check of low-confidence sentences, and an AI summary of the transcript.
- **No manual setup.** Models download automatically in the background. Per-language models are fetched only the first time that language is heard.
- **UI in 4 languages** that follows the OS (English / 中文 / 日本語 / 한국어).
- Speaker separation (Beta), SRT/VTT/TXT export, and an optional transcript autosave.

## How it works

```
audio ─► resample 16 kHz ─► Silero VAD segmenter ─┬─► partials (every 0.6 s) ─► SenseVoice ─────────────► caption
                                                  └─► final segment ─► SenseVoice (draft + language ID) ─► caption
                                                                         └─► refine worker ─► caption (replaced in place)
                                                                               ja: Parakeet-TDT-CTC 0.6B
                                                                               zh: Zipformer-CTC (+ SenseVoice punctuation transfer)
                                                                               en: Parakeet-TDT 0.6B v2 (+ number normalization)
                                                                               ko: Zipformer transducer
                                                                                    └─► translation (optional) ─► caption
```

- **Desktop and extension** share `packages/core`. Models run with `onnxruntime-web` (WASM, multi-threaded) in Web Workers; the feature extraction and decoders (CTC, TDT, RNN-T, byte-level BPE, hotword beam search) are implemented in JavaScript.
- **Android** uses the same design, ported to Java on top of the native sherpa-onnx JNI library. It needs no Gradle, no Kotlin and no third-party Java dependencies.

## Accuracy (real conversational speech)

Single-sentence character/word error rate. The test sets are ~1,300 sentences from TV, YouTube, casual dialect conversation, anime, meetings and earnings calls.

| Language | Set | Error rate |
|---|---|---|
| Japanese | TV / casual / YouTube / anime | 10.7% / 9.5% / 9.5% / 11.0% |
| Chinese | meetings / web / YouTube | 6.8% / 4.8% / 7.8% |
| English | AMI meetings / earnings calls / YouTube | 11.2% / 12.3% / 12.3% |

## Getting started

Requires Node.js 22+.

```bash
npm install
npm test                 # unit tests
npm run build            # builds apps/extension/dist and apps/desktop/dist
npm run desktop          # run the desktop app (Electron)
```

- **Chrome extension:** open `chrome://extensions`, enable Developer mode, choose "Load unpacked" and select `apps/extension/dist`. Then click the toolbar icon on a page that plays audio, or press Alt+Shift+S.
- **Android:** run `apps/android/tools/setup.sh` once to fetch the build tools, then `apps/android/build.sh`. The APK is written to `apps/android/build/LiveSub.apk`.

## Project layout

```
packages/core/        shared engine: segmenter, recognizers, two-pass worker, translation, caption renderer, i18n
apps/desktop/         Electron app (system-audio loopback, overlay window, tray, file → SRT)
apps/extension/       Chrome MV3 extension (tab capture, offscreen document, page overlay, side panel)
apps/android/         Android app (foreground service, AudioPlaybackCapture, overlay window)
test/                 unit tests (node --test)
scripts/              build and icon generation
```

## Privacy

- Audio is processed on your device.
- Nothing is sent anywhere unless you turn on translation or the LLM features. Even then, only text is sent, except for the optional cloud re-check, which sends the audio of low-confidence sentences.
- The transcript is kept in memory only (the last ~80 lines) unless you enable recording.

## License

Source-available under the **[PolyForm Noncommercial License 1.0.0](LICENSE)**.
You may use, modify and share it for **noncommercial purposes** (personal use, research, education, nonprofit organizations).
Any commercial use requires a separate license from the author.

Third-party components and models keep their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Acknowledgements

Built with the help of [Claude](https://claude.ai) (Anthropic) as a coding assistant.
