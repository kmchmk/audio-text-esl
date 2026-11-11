import "server-only";

import { TEMPLATE_STATS } from "../template";
import { SUPERTONIC_VOICES } from "./supertonic";

/** How a model receives the line's emotion. */
export type EmotionMode = "none" | "azure_style" | "instructions" | "bracket_tag";

export type VoiceOption = { id: string; label: string; gender: string; accent: string };

export type ModelOption = {
  provider: "supertonic" | "openrouter";
  model: string;
  name: string;
  /** Estimated USD for the 16-line template conversation (≈1,000 characters, ≈80 s). */
  est_template_usd: number;
  price_note: string;
  emotion: EmotionMode;
  native_speed: boolean;
  free: boolean;
  voices: VoiceOption[];
};

/** Only models estimated under this for the template conversation are offered. */
export const MAX_TEMPLATE_USD = Number(process.env.MAX_TEMPLATE_USD) || 0.05;

// Capabilities documented by OpenRouter for speech models. Anything not listed gets no
// emotion control (emotion is never sent, so it can't be read aloud by mistake), and speed is
// applied after synthesis with a pitch-preserving tempo filter.
function capabilities(model: string): { emotion: EmotionMode; native_speed: boolean } {
  // MAI-Voice documents Azure styles, but OpenRouter rejected every style request in testing
  // (Nov 2026), so it is offered without emotions until that works.
  if (model.startsWith("microsoft/mai-voice")) return { emotion: "none", native_speed: true };
  if (model.startsWith("openai/")) return { emotion: "instructions", native_speed: true };
  if (/^google\/gemini.*tts/.test(model)) return { emotion: "instructions", native_speed: false };
  if (model.startsWith("fish-audio/")) return { emotion: "instructions", native_speed: false };
  if (/^elevenlabs\/eleven-(v3|v4)/.test(model)) return { emotion: "bracket_tag", native_speed: false };
  return { emotion: "none", native_speed: false };
}

const ACCENTS: Record<string, string> = {
  US: "American", GB: "British", UK: "British", AU: "Australian", IN: "Indian", IE: "Irish",
  CA: "Canadian", NZ: "New Zealand", ZA: "South African", SG: "Singaporean", PH: "Filipino",
  KE: "Kenyan", NG: "Nigerian", HK: "Hong Kong", TZ: "Tanzanian",
};

/** Best-effort voice metadata from its id. Returns null for clearly non-English voices. */
function describeVoice(model: string, id: string): VoiceOption | null {
  let gender = "unknown";
  let accent = "Not specified";
  const loc = id.match(/(?:^|[^a-z])([a-z]{2})[-_]([A-Z]{2})(?:[^A-Z]|$)/);
  if (loc) {
    if (loc[1] !== "en") return null;
    accent = ACCENTS[loc[2]] ?? loc[2];
  }
  if (model.startsWith("hexgrad/kokoro")) {
    const m = id.match(/^([a-z])([fm])_/);
    if (!m) return null;
    if (m[1] === "a") accent = "American";
    else if (m[1] === "b") accent = "British";
    else return null; // other Kokoro prefixes are non-English
    gender = m[2] === "f" ? "female" : "male";
  }
  if (/female|woman|_f$|-f$/i.test(id)) gender = "female";
  else if (/(^|[^e])male|man\b|_m$|-m$/i.test(id)) gender = "male";
  const label = id.replace(/^en[-_][A-Z]{2}[-_]?/, "").replace(/:.*$/, "").replace(/[_-]+/g, " ").trim() || id;
  return { id, label, gender, accent };
}

type OrModel = {
  id: string;
  name: string;
  architecture?: { tokenizer?: string };
  pricing: Record<string, string | undefined>;
  supported_voices?: string[];
};

function estimate(m: OrModel): { usd: number; note: string } {
  const p = Number(m.pricing.prompt || 0);
  const c = Number(m.pricing.completion || 0);
  const { chars, seconds } = TEMPLATE_STATS;
  if (m.architecture?.tokenizer === "Gemini") {
    // Text tokens ≈ chars/4; Gemini audio output ≈ 32 tokens per second.
    return { usd: p * (chars / 4) + c * seconds * 32, note: `$${(p * 1e6).toFixed(2)}/$${(c * 1e6).toFixed(2)} per M tokens` };
  }
  if (p > 0) return { usd: p * chars, note: `$${(p * 1e6).toFixed(2)} per M characters` };
  if (c > 0) return { usd: c * seconds, note: `$${(c * 60).toFixed(3)} per minute of audio` };
  return { usd: 0, note: "Free (rate limited)" };
}

let cache: { at: number; models: ModelOption[] } | undefined;

async function openrouterModels(): Promise<ModelOption[]> {
  if (cache && Date.now() - cache.at < 6 * 3600_000) return cache.models;
  const res = await fetch("https://openrouter.ai/api/v1/models?output_modalities=speech", {
    next: { revalidate: 21600 },
  });
  if (!res.ok) {
    if (cache) return cache.models;
    throw new Error(`OpenRouter models request failed (${res.status})`);
  }
  const { data } = (await res.json()) as { data: OrModel[] };
  const models: ModelOption[] = [];
  for (const m of data) {
    const { usd, note } = estimate(m);
    if (usd >= MAX_TEMPLATE_USD) continue;
    const voices = (m.supported_voices ?? [])
      .map((v) => describeVoice(m.id, v))
      .filter((v): v is VoiceOption => !!v);
    if (!voices.length) continue; // no selectable voices
    models.push({
      provider: "openrouter",
      model: m.id,
      name: m.name,
      est_template_usd: usd,
      price_note: note,
      free: usd === 0,
      voices,
      ...capabilities(m.id),
    });
  }
  models.sort((a, b) => a.est_template_usd - b.est_template_usd || a.name.localeCompare(b.name));
  cache = { at: Date.now(), models };
  return models;
}

export const SUPERTONIC_MODEL: ModelOption = {
  provider: "supertonic",
  model: "supertonic-3",
  name: "Supertonic 3 (free, runs on our server)",
  est_template_usd: 0,
  price_note: "Free",
  emotion: "none",
  native_speed: true,
  free: true,
  voices: SUPERTONIC_VOICES.map((v) => ({
    id: v.id,
    label: `${v.gender === "male" ? "Male" : "Female"} ${v.id.slice(1)}`,
    gender: v.gender,
    accent: "American",
  })),
};

/** Every model a teacher can pick: free local Supertonic first, then OpenRouter under the cap. */
export async function listModels(): Promise<ModelOption[]> {
  try {
    return [SUPERTONIC_MODEL, ...(await openrouterModels())];
  } catch (e) {
    console.warn("[catalog]", e);
    return [SUPERTONIC_MODEL];
  }
}

export async function findModel(provider: string, model: string): Promise<ModelOption | undefined> {
  return (await listModels()).find((m) => m.provider === provider && m.model === model);
}
