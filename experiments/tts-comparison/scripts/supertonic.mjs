// Minimal Supertonic 3 inference, independent of the onnxruntime flavour (node or web/wasm).
import fs from "node:fs";
import path from "node:path";

export async function loadSupertonic(ort, dir, sessionOpts = {}) {
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "onnx/tts.json"), "utf8"));
  const indexer = JSON.parse(fs.readFileSync(path.join(dir, "onnx/unicode_indexer.json"), "utf8"));
  const load = (n) => ort.InferenceSession.create(path.join(dir, "onnx", `${n}.onnx`), sessionOpts);
  const [dp, enc, est, voc] = await Promise.all(
    ["duration_predictor", "text_encoder", "vector_estimator", "vocoder"].map(load));
  const sr = cfg.ae.sample_rate, chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
  const ldim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;

  const voice = (name) => {
    const v = JSON.parse(fs.readFileSync(path.join(dir, "voice_styles", `${name}.json`), "utf8"));
    const t = (s) => new ort.Tensor("float32", Float32Array.from(s.data.flat(Infinity)), s.dims);
    return { ttl: t(v.style_ttl), dp: t(v.style_dp) };
  };

  const prep = (text) => {
    text = text.normalize("NFKD").replace(/[–‑—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’´`]/g, "'")
      .replace(/[_\[\]|/#→←]/g, " ").replace(/\s+([,.!?;:'])/g, "$1").replace(/\s+/g, " ").trim();
    if (!/[.!?;:,'"')\]}…]$/.test(text)) text += ".";
    return `<en>${text}</en>`;
  };

  async function synth(text, style, { speed = 1.05, steps = 8 } = {}) {
    const ids = Array.from(prep(text)).map((c) => indexer[c.charCodeAt(0)] ?? 0);
    const L = ids.length;
    const textIds = new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, L]);
    const textMask = new ort.Tensor("float32", new Float32Array(L).fill(1), [1, 1, L]);
    const { duration } = await dp.run({ text_ids: textIds, style_dp: style.dp, text_mask: textMask });
    const dur = duration.data[0] / speed;
    const { text_emb } = await enc.run({ text_ids: textIds, style_ttl: style.ttl, text_mask: textMask });
    const T = Math.ceil((dur * sr) / chunk);
    let latent = new Float32Array(ldim * T);
    for (let i = 0; i < latent.length; i++) // Box-Muller gaussian noise
      latent[i] = Math.sqrt(-2 * Math.log(Math.max(1e-10, Math.random()))) * Math.cos(2 * Math.PI * Math.random());
    const latentMask = new ort.Tensor("float32", new Float32Array(T).fill(1), [1, 1, T]);
    const total = new ort.Tensor("float32", Float32Array.of(steps), [1]);
    for (let s = 0; s < steps; s++) {
      const out = await est.run({
        noisy_latent: new ort.Tensor("float32", latent, [1, ldim, T]), text_emb, style_ttl: style.ttl,
        text_mask: textMask, latent_mask: latentMask, total_step: total,
        current_step: new ort.Tensor("float32", Float32Array.of(s), [1]),
      });
      latent = out.denoised_latent.data;
    }
    const { wav_tts } = await voc.run({ latent: new ort.Tensor("float32", latent, [1, ldim, T]) });
    return wav_tts.data.subarray(0, Math.floor(dur * sr)); // trim padding to predicted duration
  }
  return { synth, voice, sampleRate: sr };
}
