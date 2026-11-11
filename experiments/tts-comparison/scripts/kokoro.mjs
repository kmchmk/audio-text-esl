import { KokoroTTS } from "kokoro-js";
import fs from "node:fs";
const lines = JSON.parse(fs.readFileSync("conversation.json", "utf8"));
const voices = { dad: "am_michael", mom: "af_heart", son: "am_puck", daughter: "af_bella" };
const dtype = process.argv[2] || "fp32";
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype, device: "cpu" });
const SR = 24000, PAUSE = Math.round(SR * 0.45);
const parts = []; const t0 = Date.now();
for (const [who, text] of lines) {
  const a = await tts.generate(text, { voice: voices[who], speed: 1.0 });
  parts.push(a.audio, new Float32Array(PAUSE));
}
const total = parts.reduce((n, p) => n + p.length, 0);
const out = new Float32Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
fs.writeFileSync(`kokoro-${dtype}.f32`, Buffer.from(out.buffer));
console.log(`kokoro ${dtype}: ${(total/SR).toFixed(1)}s audio in ${((Date.now()-t0)/1000).toFixed(1)}s`);
