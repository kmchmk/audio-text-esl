// Smoke test: Supertonic → MP3 → Neon storage round trip. Run with --conditions=react-server.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { synthesizeLine } = await import("../src/lib/tts/index.ts");
const { encodeMp3, durationMs } = await import("../src/lib/audio.ts");
const { putObject, getObject, signedUrl } = await import("../src/lib/storage.ts");
const t0 = Date.now();
const r = await synthesizeLine({ provider: "supertonic", model: "supertonic-3", voice: "F1", text: "Dinner's ready, everyone! Come and sit down before it gets cold.", emotion: "neutral", speed: 1 });
console.log("synth", durationMs(r.pcm), "ms audio in", Date.now() - t0, "ms");
const mp3 = await encodeMp3(r.pcm);
await putObject("smoke/test.mp3", mp3);
const back = await getObject("smoke/test.mp3");
console.log("storage roundtrip", mp3.length, back.length, (await signedUrl("smoke/test.mp3")).slice(0, 60));
