import { after } from "next/server";

import { requireUser } from "@/lib/auth/server";
import { startGeneration, triggerWorker, UserError } from "@/lib/generation";

/** "Convert to audio": snapshot the draft as a new version and start generating it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  try {
    const r = await startGeneration(user.id, id);
    const origin = new URL(req.url).origin;
    after(() => triggerWorker(origin, r.generationId));
    return Response.json(r);
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
