# Third-party notices

LiveSub's own source code is licensed under the PolyForm Noncommercial License 1.0.0 (see `LICENSE`).
The components below are **not** covered by that license. Each keeps its own terms.

## Bundled or linked software

| Component | Used for | License |
|---|---|---|
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Android JNI library; the Java classes in `apps/android/app/src/com/k2fsa/` mirror its Kotlin API; byte-level BPE table | Apache-2.0 |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) / onnxruntime-web | model inference (WASM, Android native) | MIT |
| [Transformers.js](https://github.com/huggingface/transformers.js) | optional Whisper engine | Apache-2.0 |
| [Electron](https://github.com/electron/electron) | desktop app runtime | MIT |
| [Silero VAD](https://github.com/snakers4/silero-vad) (`silero_vad.onnx`, bundled) | voice activity detection | MIT |

## Speech models (downloaded at runtime, not redistributed in this repository)

| Model | Source | License / terms |
|---|---|---|
| SenseVoice-Small | FunAudioLLM / Alibaba (sherpa-onnx export) | FunASR model license, which requires attribution. Check the upstream terms before any commercial use |
| Parakeet-TDT-CTC 0.6B (Japanese) | NVIDIA NeMo (sherpa-onnx export) | CC-BY-4.0 |
| Parakeet-TDT 0.6B v2 (English) | NVIDIA NeMo (sherpa-onnx export) | CC-BY-4.0 |
| Zipformer CTC (Chinese, 2025-07-03) | k2-fsa / icefall | See the upstream model card |
| Zipformer transducer (Korean, 2024-06-24) | k2-fsa / icefall, trained on KsponSpeech | See the upstream model card and the KsponSpeech dataset terms |
| 3D-Speaker CAM++ | ModelScope 3D-Speaker | Apache-2.0 |
| Whisper (optional) | OpenAI (ONNX export by onnx-community) | MIT |

Model licenses can change, so always check the upstream model cards. The desktop app and the extension download these files from Hugging Face (or a mirror) on first use.
