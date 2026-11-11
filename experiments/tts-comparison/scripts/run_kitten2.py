import json, sys, time, numpy as np, soundfile as sf
from kittenml import KittenTTS
BASE = sys.argv[1]
lines = json.load(open(f"{BASE}/tts/conversation.json"))
emo = ["excited","excited","joyful","joyful","excited","excited","excited","tender",
       "joyful","surprised","mundane","surprised","mundane","angry","mundane","stern"]
v = {"dad":"Marcus","mom":"Maeve","son":"Dante","daughter":"Kiki"}
m = KittenTTS("KittenML/kitten-tts-2")
sr = m.sample_rate; out = []; t0 = time.time()
for (who, text), e in zip(lines, emo):
    t = time.time()
    a = np.asarray(m.generate(f"[{e}] {text}", voice=v[who], preset="expressive"), dtype=np.float32).reshape(-1)
    a = a / (np.abs(a).max() or 1) * 0.9
    out += [a, np.zeros(int(sr*0.45), np.float32)]
    print(f"line {who} {e}: {len(a)/sr:.1f}s in {time.time()-t:.1f}s", flush=True)
a = np.concatenate(out); sf.write(f"{BASE}/tts/kitten2.wav", a, sr)
print(f"kitten2: {len(a)/sr:.1f}s audio in {time.time()-t0:.1f}s")
