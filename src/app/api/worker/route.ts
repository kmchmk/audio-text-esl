import { after } from "next/server";

import { processGeneration, triggerWorker, verifyWorkerSignature } from "@/lib/generation";

// Synthesis (Supertonic runs on this function) and stitching need time and memory.
export const maxDuration = 300;

/** Internal: accepts a signed job id, answers at once and processes it in the background. */
export async function POST(req: Request) {
  const { id, sig } = (await req.json()) as { id: string; sig: string };
  if (!id || !verifyWorkerSignature(id, sig)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const origin = new URL(req.url).origin;
  after(async () => {
    const result = await processGeneration(id);
    // Out of time with lines left: hand over to a fresh invocation.
    if (result === "more") await triggerWorker(origin, id);
  });
  return Response.json({ accepted: true }, { status: 202 });
}
