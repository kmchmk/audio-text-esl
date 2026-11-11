import "server-only";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type * as Ort from "onnxruntime-node";

// Supertonic 3 (Supertone, Open RAIL-M weights). The upstream project is archived, so the
// revision is pinned. Files (~398 MB) are fetched into /tmp on a cold start and reused while
// the function instance stays warm. SUPERTONIC_DIR can point at a local copy instead.
const REPO = "https://huggingface.co/Supertone/supertonic-3/resolve/724fb5abbf5502583fb520898d45929e62f02c0b";
const ONNX = ["duration_predictor", "text_encoder", "vector_estimator", "vocoder"] as const;

export const SUPERTONIC_VOICES = [
  { id: "M1", gender: "male" },
  { id: "M2", gender: "male" },
  { id: "M3", gender: "male" },
  { id: "M4", gender: "male" },
  { id: "M5", gender: "male" },
  { id: "F1", gender: "female" },
  { id: "F2", gender: "female" },
  { id: "F3", gender: "female" },
  { id: "F4", gender: "female" },
  { id: "F5", gender: "female" },
] as const;

type Engine = Awaited<ReturnType<typeof load>>;
let engine: Promise<Engine> | undefined;

async function fetchTo(rel: string, dir: string) {
  const dest = path.join(dir, rel);
  try {
    await fs.access(dest);
    return dest;
  } catch {}
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(`${REPO}/${rel}`);
  if (!res.ok || !res.body) throw new Error(`Supertonic download failed (${res.status}) for ${rel}`);
  const tmp = `${dest}.part`;
  await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  await fs.rename(tmp, dest);
  return dest;
}

async function load() {
  const dir = process.env.SUPERTONIC_DIR || path.join(os.tmpdir(), "supertonic3");
  const ort: typeof Ort = await import("onnxruntime-node");
  const [cfgPath, idxPath] = await Promise.all([fetchTo("onnx/tts.json", dir), fetchTo("onnx/unicode_indexer.json", dir)]);
  const cfg = JSON.parse(await fs.readFile(cfgPath, "utf8"));
  const indexer: number[] = JSON.parse(await fs.readFile(idxPath, "utf8"));
  // Sequential downloads keep peak memory low (each file is buffered once).
  const sessions: Ort.InferenceSession[] = [];
  for (const n of ONNX) {
    const file = await fetchTo(`onnx/${n}.onnx`, dir);
    sessions.push(await ort.InferenceSession.create(file, { intraOpNumThreads: 2 }));
  }
  const [dp, enc, est, voc] = sessions;
  const sr: number = cfg.ae.sample_rate;
  const chunk: number = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
  const ldim: number = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  const styles = new Map<string, { ttl: Ort.Tensor; dp: Ort.Tensor }>();

  async function style(voice: string) {
    if (!SUPERTONIC_VOICES.some((v) => v.id === voice)) throw new Error(`Unknown Supertonic voice ${voice}`);
    let s = styles.get(voice);
    if (!s) {
      const v = JSON.parse(await fs.readFile(await fetchTo(`voice_styles/${voice}.json`, dir), "utf8"));
      const t = (x: { data: unknown[]; dims: number[] }) =>
        new ort.Tensor("float32", Float32Array.from(x.data.flat(Infinity) as number[]), x.dims);
      s = { ttl: t(v.style_ttl), dp: t(v.style_dp) };
      styles.set(voice, s);
    }
    return s;
  }

  function prep(text: string) {
    text = text
      .normalize("NFKD")
      .replace(/[–‑—]/g, "-")
      .replace(/[“”]/g, '"')
      .replace(/[‘’´`]/g, "'")
      .replace(/[_[\]|/#→←]/g, " ")
      .replace(/\s+([,.!?;:'])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!/[.!?;:,'")\]}…]$/.test(text)) text += ".";
    return `<en>${text}</en>`;
  }

  /** One sentence or short paragraph → mono float32 PCM at `sampleRate`. */
  async function synth(text: string, voice: string, speed = 1.05, steps = 8) {
    const st = await style(voice);
    const ids = Array.from(prep(text)).map((c) => indexer[c.charCodeAt(0)] ?? 0);
    const L = ids.length;
    const textIds = new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, L]);
    const textMask = new ort.Tensor("float32", new Float32Array(L).fill(1), [1, 1, L]);
    const { duration } = await dp.run({ text_ids: textIds, style_dp: st.dp, text_mask: textMask });
    const dur = (duration.data as Float32Array)[0] / speed;
    const { text_emb } = await enc.run({ text_ids: textIds, style_ttl: st.ttl, text_mask: textMask });
    const T = Math.max(1, Math.ceil((dur * sr) / chunk));
    let latent: Float32Array<ArrayBufferLike> = new Float32Array(ldim * T);
    for (let i = 0; i < latent.length; i++)
      latent[i] = Math.sqrt(-2 * Math.log(Math.max(1e-10, Math.random()))) * Math.cos(2 * Math.PI * Math.random());
    const latentMask = new ort.Tensor("float32", new Float32Array(T).fill(1), [1, 1, T]);
    const total = new ort.Tensor("float32", Float32Array.of(steps), [1]);
    for (let s = 0; s < steps; s++) {
      const out = await est.run({
        noisy_latent: new ort.Tensor("float32", latent, [1, ldim, T]),
        text_emb,
        style_ttl: st.ttl,
        text_mask: textMask,
        latent_mask: latentMask,
        total_step: total,
        current_step: new ort.Tensor("float32", Float32Array.of(s), [1]),
      });
      latent = out.denoised_latent.data as Float32Array;
    }
    const { wav_tts } = await voc.run({ latent: new ort.Tensor("float32", latent, [1, ldim, T]) });
    return (wav_tts.data as Float32Array).slice(0, Math.floor(dur * sr));
  }

  return { synth, sampleRate: sr };
}

export function supertonic(): Promise<Engine> {
  engine ??= load().catch((e) => {
    engine = undefined; // allow a retry on the next call
    throw e;
  });
  return engine;
}
