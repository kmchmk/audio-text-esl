import fs from "node:fs";
import { loadSupertonic } from "./supertonic.mjs";
const flavour = process.argv[2] || "node";
const ort = flavour === "node" ? await import("onnxruntime-node") : await import("onnxruntime-web");
if (flavour === "web") ort.env.wasm.numThreads = Number(process.argv[3] || 1);
const lines = JSON.parse(fs.readFileSync(process.env.CONV, "utf8"));
const t0 = Date.now();
const tts = await loadSupertonic(ort, process.env.ST_DIR);
console.log(`${flavour}: load ${(Date.now() - t0) / 1000}s`);
const voices = { dad: "M1", mom: "F1", son: "M3", daughter: "F3" };
const styles = Object.fromEntries(Object.entries(voices).map(([k, v]) => [k, tts.voice(v)]));
const pause = new Float32Array(Math.round(tts.sampleRate * 0.45));
const parts = []; const t1 = Date.now();
for (const [who, text] of lines) parts.push(await tts.synth(text, styles[who]), pause);
const n = parts.reduce((a, p) => a + p.length, 0), out = new Float32Array(n);
let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
fs.writeFileSync(`st-${flavour}.f32`, Buffer.from(out.buffer));
console.log(`${flavour}: ${(n / tts.sampleRate).toFixed(1)}s audio in ${(Date.now() - t1) / 1000}s, rss ${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`);
