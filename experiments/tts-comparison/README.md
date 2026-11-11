# Local TTS comparison (Nov 2026)

The same 16-line family dinner conversation (`scripts/conversation.json`) generated with five
local/open TTS engines. There is a 0.45 s pause between lines, and each line is
peak-normalised. Everything ran on a 4-vCPU cloud container with no GPU.

| # | Sample | Engine | Voices (dad / mom / son / daughter) | Gen time for audio length | Whisper WER* | Emotion control | Browser? |
|---|---|---|---|---|---|---|---|
| 1 | `samples/1-kokoro.mp3` | Kokoro 82M via `kokoro-js` 1.2.1 (fp32, Node) | am_michael / af_heart / am_puck / af_bella | 19.5 s for 76 s | 0.5% | none (speed only) | yes: `kokoro-js`, WebGPU or WASM |
| 2 | `samples/2-supertonic3.mp3` | Supertonic 3 (Supertone, ONNX) | M1 / F1 / M3 / F3 | 18.4 s for 82 s | 0.0% | none (speed only) | yes: ONNX Runtime Web |
| 3 | `samples/3-pocket-tts.mp3` | Kyutai Pocket TTS (100M) | javert / alba / paul / cosette | 42.9 s for 80 s | 0.0% | indirect: inherits the style of the reference clip | ONNX/WASM ports exist (npm `pocket-tts` local mode) |
| 4 | `samples/4-kittentts2-emotion.mp3` | KittenTTS 2 (1.7B) | Marcus / Maeve / Dante / Kiki | **431 s** for 113 s | 4.9% (**hallucinated a phrase in line 6**) | yes: `[excited]`, `[sad]`, `[angry]`… tags | no, too big (≈1 GB); server/GPU only |
| 5 | `samples/5-piper.mp3` | Piper 1.8 (VITS) | ryan-high / lessac-high / joe / kristin | 8.0 s for 70 s | 1.6% | none | yes: `piper-tts-web` (WASM) |

\* Word error rate when the MP3 is transcribed with Whisper `small.en` and compared with
the script. This is a rough intelligibility check, not a measure of naturalness.

## Licences (verify before shipping)
- Kokoro: Apache-2.0.
- Supertonic: MIT code; check the model-weights licence on Hugging Face.
- Pocket TTS: check the Kyutai model card.
- KittenTTS 2: Stellon Labs Community License. Free under USD 1M revenue/funding, and it
  requires registration for commercial use plus a "Powered by KittenML" attribution.
- Piper: GPL-3.0 engine; each voice has its own licence.

## Reproduce
```bash
# Kokoro (Node)
npm i kokoro-js && node scripts/kokoro.mjs fp32
# Others (Python venv: pip install supertonic piper-tts pocket-tts soundfile)
python scripts/run_engines.py <base> supertonic|piper|pocket
# KittenTTS 2 (separate venv: pip install kittenml soundfile)
python scripts/run_kitten2.py <base>
```
The scripts expect `<base>/tts/conversation.json`, and Piper voices in `<base>/piper/`.
