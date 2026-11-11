import "server-only";

import type { Emotion } from "../emotions";
import { env } from "../env";
import type { EmotionMode } from "./catalog";

const API = "https://openrouter.ai/api/v1";

const AZURE_STYLE: Partial<Record<Emotion, string>> = {
  friendly: "friendly",
  cheerful: "cheerful",
  excited: "excited",
  sad: "sad",
  angry: "angry",
  serious: "serious",
  whispering: "whispering",
  surprised: "excited",
  worried: "fearful",
};

const INSTRUCTION: Partial<Record<Emotion, string>> = {
  friendly: "Speak in a warm, friendly tone.",
  cheerful: "Speak in a cheerful, happy tone.",
  excited: "Speak with excitement and energy.",
  sad: "Speak in a sad, quiet tone.",
  angry: "Speak in an angry, irritated tone.",
  serious: "Speak in a serious, calm tone.",
  whispering: "Whisper softly.",
  surprised: "Speak with surprise.",
  worried: "Speak in a worried, nervous tone.",
};

const TAG: Partial<Record<Emotion, string>> = {
  friendly: "[warmly]",
  cheerful: "[cheerfully]",
  excited: "[excited]",
  sad: "[sad]",
  angry: "[angry]",
  serious: "[seriously]",
  whispering: "[whispers]",
  surprised: "[surprised]",
  worried: "[nervously]",
};

export type OrResult = { audio: Buffer; format: "mp3" | "pcm"; pcmRate: number; generationId: string | null };

async function speech(body: Record<string, unknown>) {
  return fetch(`${API}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env().openrouterKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Synthesize one line. Tries MP3 first and falls back to PCM for providers that only return PCM. */
export async function openrouterSpeech(opts: {
  model: string;
  voice: string;
  text: string;
  emotion: Emotion;
  emotionMode: EmotionMode;
  speed?: number; // only sent when the model supports native speed
}): Promise<OrResult> {
  if (!env().openrouterKey) throw new Error("OPENROUTER_API_KEY is not set");
  const body: Record<string, unknown> = { model: opts.model, voice: opts.voice, input: opts.text };
  if (opts.speed && Math.abs(opts.speed - 1) > 0.01) body.speed = opts.speed;
  if (opts.emotion !== "neutral") {
    if (opts.emotionMode === "azure_style" && AZURE_STYLE[opts.emotion])
      body.provider = { options: { azure: { style: AZURE_STYLE[opts.emotion], styledegree: 1.2 } } };
    if (opts.emotionMode === "instructions" && INSTRUCTION[opts.emotion]) body.instructions = INSTRUCTION[opts.emotion];
    if (opts.emotionMode === "bracket_tag" && TAG[opts.emotion]) body.input = `${TAG[opts.emotion]} ${opts.text}`;
  }

  let res = await speech({ ...body, response_format: "mp3" });
  let format: "mp3" | "pcm" = "mp3";
  if (res.status === 400) {
    const err = await res.text();
    if (/format|pcm|mp3/i.test(err)) {
      res = await speech({ ...body, response_format: "pcm" });
      format = "pcm";
    } else throw new Error(`OpenRouter 400: ${err.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json")) throw new Error(`OpenRouter returned JSON: ${(await res.text()).slice(0, 300)}`);
  if (ct.includes("pcm")) format = "pcm";
  const rate = Number(ct.match(/rate=(\d+)/)?.[1]) || 24000;
  return {
    audio: Buffer.from(await res.arrayBuffer()),
    format,
    pcmRate: rate,
    generationId: res.headers.get("x-generation-id"),
  };
}

/** Actual USD cost of a generation. OpenRouter fills this in shortly after the request. */
export async function generationCost(id: string, tries = 6): Promise<number | null> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${API}/generation?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${env().openrouterKey}` },
      cache: "no-store",
    });
    if (res.ok) {
      const { data } = (await res.json()) as { data?: { total_cost?: number } };
      if (typeof data?.total_cost === "number") return data.total_cost;
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  return null;
}

export type Budget = {
  /** Spending cap on the app's key (USD), or null when the key has no cap. */
  keyLimit: number | null;
  keyUsed: number;
  /** What the app can still spend: the key's remaining cap, else the account balance. */
  remaining: number | null;
  /** Account-wide balance, only when OPENROUTER_MANAGEMENT_KEY is set. */
  account: { total: number; used: number; remaining: number } | null;
};

/** The shared budget everyone sees. Uses the app key's cap; the management key adds the account balance. */
export async function budget(): Promise<Budget | null> {
  const { openrouterKey, openrouterManagementKey } = env();
  if (!openrouterKey) return null;
  const [k, c] = await Promise.all([
    fetch(`${API}/key`, { headers: { Authorization: `Bearer ${openrouterKey}` }, cache: "no-store" }),
    openrouterManagementKey
      ? fetch(`${API}/credits`, { headers: { Authorization: `Bearer ${openrouterManagementKey}` }, cache: "no-store" })
      : null,
  ]);
  if (!k.ok) return null;
  const kd = ((await k.json()) as { data: { limit: number | null; limit_remaining: number | null; usage: number } }).data;
  let account: Budget["account"] = null;
  if (c?.ok) {
    const cd = ((await c.json()) as { data: { total_credits: number; total_usage: number } }).data;
    account = { total: cd.total_credits, used: cd.total_usage, remaining: cd.total_credits - cd.total_usage };
  }
  const remaining =
    kd.limit_remaining != null && account ? Math.min(kd.limit_remaining, account.remaining) : kd.limit_remaining ?? account?.remaining ?? null;
  return { keyLimit: kd.limit, keyUsed: kd.usage, remaining, account };
}
