import "server-only";

import { createHash } from "node:crypto";

import { changeTempo, decode, resample, tidy } from "../audio";
import type { Emotion } from "../emotions";
import { findModel, type EmotionMode } from "./catalog";
import { generationCost, openrouterSpeech } from "./openrouter";
import { supertonic } from "./supertonic";

export type LineSpec = {
  provider: string;
  model: string;
  voice: string;
  text: string;
  emotion: Emotion;
  speed: number;
};

/** Bump when synthesis or post-processing changes, so old cached clips aren't reused. */
const PIPELINE_VERSION = 1;

/** What the model actually receives. Emotion is dropped for models that can't use it. */
export function effectiveSpec(spec: LineSpec, emotionMode: EmotionMode): LineSpec {
  return { ...spec, text: spec.text.trim(), emotion: emotionMode === "none" ? "neutral" : spec.emotion, speed: Math.round(spec.speed * 100) / 100 };
}

export function cacheKey(spec: LineSpec): string {
  const s = JSON.stringify([PIPELINE_VERSION, spec.provider, spec.model, spec.voice, spec.text, spec.emotion, spec.speed]);
  return createHash("sha256").update(s).digest("hex");
}

export type Synthesized = { pcm: Float32Array; costUsd: number; providerGenerationId: string | null };

/** Synthesize one line to tidy mono PCM (44.1 kHz) and report its actual cost. */
export async function synthesizeLine(spec: LineSpec): Promise<Synthesized> {
  if (spec.provider === "supertonic") {
    const st = await supertonic();
    // Supertonic's natural pace is its default 1.05; scale that by the teacher's speed.
    const raw = await st.synth(spec.text, spec.voice, 1.05 * spec.speed);
    return { pcm: tidy(await resample(raw, st.sampleRate)), costUsd: 0, providerGenerationId: null };
  }
  if (spec.provider === "openrouter") {
    const model = await findModel("openrouter", spec.model);
    if (!model) throw new Error(`Model ${spec.model} is not available (price cap or removed).`);
    const r = await openrouterSpeech({
      model: spec.model,
      voice: spec.voice,
      text: spec.text,
      emotion: spec.emotion,
      emotionMode: model.emotion,
      speed: model.native_speed ? spec.speed : undefined,
    });
    let pcm =
      r.format === "pcm"
        ? await resample(int16ToFloat(r.audio), r.pcmRate)
        : await decode(r.audio);
    if (!model.native_speed) pcm = await changeTempo(pcm, spec.speed);
    const cost = r.generationId ? await generationCost(r.generationId) : null;
    // Fall back to the list price when OpenRouter hasn't reported the cost yet.
    const est = (model.est_template_usd / 995) * spec.text.length;
    return { pcm: tidy(pcm), costUsd: cost ?? est, providerGenerationId: r.generationId };
  }
  throw new Error(`Unknown provider ${spec.provider}`);
}

function int16ToFloat(b: Buffer): Float32Array {
  const n = Math.floor(b.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(i * 2) / 32768;
  return out;
}
