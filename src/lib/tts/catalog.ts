import "server-only";

import { TEMPLATE_STATS } from "../template";
import { SUPERTONIC_VOICES } from "./supertonic";

/** How a model receives the line's emotion. */
export type EmotionMode = "none" | "azure_style" | "instructions" | "bracket_tag" | "fish_prompt";

export type VoiceOption = { id: string; label: string; gender: string; accent: string; age?: string };

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
  /** Has voices that sound like real children (approved in listening tests). */
  child_voices: boolean;
  /** Plain-language facts teachers should know when picking this service. */
  notes: string[];
  voices: VoiceOption[];
};

/** Only models estimated under this for the template conversation are offered. */
export const MAX_TEMPLATE_USD = Number(process.env.MAX_TEMPLATE_USD) || 0.05;

/**
 * Exceptions to the price cap: no cheaper model has real child voices (Nov 2026 listening
 * tests), so MiniMax is offered with only the child and teen voices approved by ear.
 */
const CHILD_VOICES: Record<string, { name: string; voices: VoiceOption[] }> = {
  "minimax/speech-2.8-turbo": {
    name: "MiniMax Speech 2.8 Turbo (child voices)",
    voices: [
      ["English_radiant_girl", "Radiant girl", "female", "child"],
      ["English_PlayfulGirl", "Playful girl", "female", "child"],
      ["English_LovelyGirl", "Lovely girl", "female", "child"],
      ["English_WhimsicalGirl", "Whimsical girl", "female", "child"],
      ["English_Kind-heartedGirl", "Kind-hearted girl", "female", "child"],
      ["English_Soft-spokenGirl", "Soft-spoken girl", "female", "child"],
      ["English_Strong-WilledBoy", "Strong-willed boy", "male", "child"],
      ["English_SadTeen", "Sad teen", "unknown", "teen"],
      ["English_AnimeCharacter", "Anime character", "unknown", "teen"],
    ].map(([id, label, gender, age]) => ({ id, label, gender, age, accent: "Not specified" })),
  },
};

/**
 * Fish Audio Drama 3 has no voice list: the voice is described in words. "preset:" voices are
 * descriptions we tested; only a girl sounded like a real child (a boy could not be produced).
 */
export const FISH_MODEL = "fish-audio/drama-3";
export const FISH_PRESETS: Record<string, string> = {
  "preset:girl-child": "a cheerful eight-year-old girl, small high child's voice",
};
const FISH_VOICES: VoiceOption[] = [
  { id: "preset:girl-child", label: "Girl, about 8 years old", gender: "female", age: "child", accent: "Not specified" },
];

/** What teachers should know about each service, shown in the character editor. */
function notesFor(model: string): string[] {
  if (model === FISH_MODEL)
    return [
      "Real child voice: a girl of about 8. There is no boy voice; we tried and it always came out as a girl. For a boy, use MiniMax's \"Strong-willed boy\".",
      "The voice is described in words for each line, so it can vary slightly from line to line.",
      "Emotions work.",
    ];
  if (model.startsWith("minimax/"))
    return [
      "Real child and teen voices (the only service with a boy).",
      "Costs more than the other paid voices, so only use it for child characters.",
      "Emotions are not available: the emotion you pick is ignored for these voices. Speed still works.",
    ];
  if (model.startsWith("microsoft/mai-voice"))
    return ["Adult voices only.", "Emotions are not available: the service rejects emotion settings, so they are ignored."];
  if (/^google\/gemini.*tts/.test(model)) return ["Adult voices only.", "Emotions work."];
  if (/^elevenlabs\/eleven-(v3|v4)/.test(model)) return ["Adult voices only.", "Emotions work."];
  if (model.endsWith(":free")) return ["Adult voices only.", "Free but rate limited: it can fail when many people use it.", "Emotions are not available."];
  if (model.startsWith("hexgrad/kokoro")) return ["Adult voices only.", "Very cheap, but can take 30+ seconds per line.", "Emotions are not available."];
  return ["Adult voices only.", "Emotions are not available: the emotion you pick is ignored."];
}

// Capabilities documented by OpenRouter for speech models. Anything not listed gets no
// emotion control (emotion is never sent, so it can't be read aloud by mistake), and speed is
// applied after synthesis with a pitch-preserving tempo filter.
function capabilities(model: string): { emotion: EmotionMode; native_speed: boolean } {
  // MAI-Voice documents Azure styles, but OpenRouter rejected every style request in testing
  // (Nov 2026), so it is offered without emotions until that works.
  if (model.startsWith("microsoft/mai-voice")) return { emotion: "none", native_speed: true };
  if (model.startsWith("openai/")) return { emotion: "instructions", native_speed: true };
  if (/^google\/gemini.*tts/.test(model)) return { emotion: "instructions", native_speed: false };
  if (model === FISH_MODEL) return { emotion: "fish_prompt", native_speed: false };
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
    const kids = CHILD_VOICES[m.id];
    const fish = m.id === FISH_MODEL;
    if (usd >= MAX_TEMPLATE_USD && !kids) continue;
    const offered = new Set(m.supported_voices ?? []);
    const voices = fish
      ? FISH_VOICES
      : kids
        ? kids.voices.filter((v) => offered.has(v.id))
        : (m.supported_voices ?? []).map((v) => describeVoice(m.id, v)).filter((v): v is VoiceOption => !!v);
    if (!voices.length) continue; // no selectable voices
    models.push({
      provider: "openrouter",
      model: m.id,
      name: fish ? "Fish Audio Drama 3 (child girl voice)" : (kids?.name ?? m.name),
      est_template_usd: usd,
      price_note: note,
      free: usd === 0,
      child_voices: fish || !!kids,
      notes: notesFor(m.id),
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
  child_voices: false,
  notes: [
    "Free: runs on our own server, so it never uses the shared budget.",
    "Adult voices only. Free voices that sound like children don't exist yet; for children use MiniMax or Fish Audio (small cost).",
    "Emotions are not available: the emotion you pick is ignored. Speed works.",
    "The first conversion after a quiet period can take about 30 seconds while the voice engine starts.",
  ],
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
