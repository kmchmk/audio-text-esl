import json, sys, time, numpy as np, soundfile as sf
BASE = sys.argv[1]; engine = sys.argv[2]
lines = json.load(open(f"{BASE}/tts/conversation.json"))
PAUSE = 0.45
def stitch(clips, sr, name, t0):
    out = []
    for c in clips:
        c = np.asarray(c, dtype=np.float32).reshape(-1)
        peak = np.abs(c).max() or 1; c = c / peak * 0.9  # normalize loudness per line
        out += [c, np.zeros(int(sr*PAUSE), np.float32)]
    a = np.concatenate(out); sf.write(f"{BASE}/tts/{name}.wav", a, sr)
    print(f"{name}: {len(a)/sr:.1f}s audio in {time.time()-t0:.1f}s", flush=True)

if engine == "supertonic":
    from supertonic import TTS
    tts = TTS(); v = {"dad":"M1","mom":"F1","son":"M3","daughter":"F3"}
    t0 = time.time(); clips = []
    for who, text in lines:
        wav, _ = tts.synthesize(text, voice_style=tts.get_voice_style(v[who]), lang="en"); clips.append(wav)
    stitch(clips, tts.sample_rate, "supertonic3", t0)
elif engine == "piper":
    from piper import PiperVoice
    v = {"dad":"en_US-ryan-high","mom":"en_US-lessac-high","son":"en_US-joe-medium","daughter":"en_US-kristin-medium"}
    voices = {k: PiperVoice.load(f"{BASE}/piper/{n}.onnx") for k, n in v.items()}
    t0 = time.time(); clips = []
    for who, text in lines:
        clips.append(np.concatenate([c.audio_float_array for c in voices[who].synthesize(text)]))
    # resample-free: all chosen voices are 22050 Hz
    stitch(clips, 22050, "piper", t0)
elif engine == "pocket":
    from pocket_tts import TTSModel
    m = TTSModel.load_model()
    v = {"dad":"javert","mom":"alba","son":"paul","daughter":"cosette"}
    states = {k: m.get_state_for_audio_prompt(n) for k, n in v.items()}
    t0 = time.time(); clips = []
    for who, text in lines:
        clips.append(m.generate_audio(states[who], text).numpy())
    stitch(clips, m.sample_rate, "pocket", t0)
