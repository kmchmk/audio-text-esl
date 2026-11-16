// TEMPORARY (voice research): forwards one raw speech request to OpenRouter with the app key.
// Locked to WORKER_SECRET. Remove after use.
import { timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { generationCost } from "@/lib/tts/openrouter";

export const maxDuration = 120;

export async function POST(req: Request) {
  const given = Buffer.from(req.headers.get("x-dev-key") ?? "");
  const want = Buffer.from(env().workerSecret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return new Response("forbidden", { status: 403 });
  const body = await req.text();
  const res = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${env().openrouterKey}`, "Content-Type": "application/json" },
    body,
  });
  const id = res.headers.get("x-generation-id");
  const data = Buffer.from(await res.arrayBuffer());
  const cost = res.ok && id ? await generationCost(id) : null;
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/octet-stream", "x-cost-usd": String(cost ?? "") },
  });
}
