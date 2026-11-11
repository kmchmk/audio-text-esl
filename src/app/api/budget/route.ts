import { requireUser } from "@/lib/auth/server";
import { usdThbRate } from "@/lib/env";
import { budget } from "@/lib/tts/openrouter";

let cached: { at: number; body: unknown } | undefined;

/** Shared OpenRouter budget (same for every teacher during testing), plus the THB rate. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!cached || Date.now() - cached.at > 30_000) {
    cached = { at: Date.now(), body: { budget: await budget().catch(() => null), rate: usdThbRate() } };
  }
  return Response.json(cached.body, { headers: { "Cache-Control": "private, no-store" } });
}
