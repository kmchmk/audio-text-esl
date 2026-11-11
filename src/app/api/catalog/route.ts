import { requireUser } from "@/lib/auth/server";
import { usdThbRate } from "@/lib/env";
import { listModels, MAX_TEMPLATE_USD } from "@/lib/tts/catalog";

/** Voice models and voices a teacher can pick, with estimated cost for the template. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return Response.json({ models: await listModels(), rate: usdThbRate(), maxTemplateUsd: MAX_TEMPLATE_USD });
}
