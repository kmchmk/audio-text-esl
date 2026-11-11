import { and, eq } from "drizzle-orm";
import { after } from "next/server";

import { requireUser } from "@/lib/auth/server";
import { getDb, schema as s } from "@/lib/db";
import { retryGeneration, triggerWorker } from "@/lib/generation";

/**
 * POST { action: "kick" }  – restart a generation whose worker stopped (expired lease).
 * POST { action: "retry" } – retry failed lines.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const { action } = (await req.json()) as { action: "kick" | "retry" };
  const [g] = await getDb()
    .select({ id: s.generations.id, status: s.generations.status })
    .from(s.generations)
    .where(and(eq(s.generations.id, id), eq(s.generations.user_id, user.id)));
  if (!g) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (action === "retry" && !(await retryGeneration(user.id, id)))
    return Response.json({ error: "Only failed generations can be retried." }, { status: 400 });
  if (action === "retry" || g.status === "queued" || g.status === "running") {
    const origin = new URL(req.url).origin;
    after(() => triggerWorker(origin, id));
  }
  return Response.json({ ok: true });
}
