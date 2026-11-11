import json, sys, re, jiwer
from faster_whisper import WhisperModel
BASE = sys.argv[1]
ref = " ".join(t for _, t in json.load(open(f"{BASE}/tts/conversation.json")))
norm = lambda s: re.sub(r"[^a-z0-9' ]", " ", s.lower().replace("mrs.", "mrs")).split()
m = WhisperModel("small.en", device="cpu", compute_type="int8")
for f in sys.argv[2:]:
    import subprocess, numpy as np
    raw = subprocess.run(["ffmpeg","-loglevel","error","-i",f"{BASE}/tts/{f}.mp3","-f","f32le","-ac","1","-ar","16000","-"],capture_output=True).stdout
    segs, _ = m.transcribe(np.frombuffer(raw, np.float32), beam_size=5)
    hyp = " ".join(s.text for s in segs)
    print(f"{f}: WER {jiwer.wer(' '.join(norm(ref)), ' '.join(norm(hyp)))*100:.1f}%", flush=True)
    open(f"{BASE}/tts/{f}.transcript.txt","w").write(hyp)
