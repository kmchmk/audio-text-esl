import { requireUser } from "@/lib/auth/server";
import { getConversation, getDraftLines, syncDraft, type DraftLine } from "@/lib/data";

const noStore = { "Cache-Control": "private, no-store" };

/** Current server state of a draft (used on load and as the polling fallback). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const meta = await getConversation(user.id, id);
  if (!meta) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: noStore });
  return Response.json({ meta, lines: await getDraftLines(user.id, id) }, { headers: noStore });
}

/** Apply queued edits from a device (idempotent, newest edit per line wins). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = (await req.json()) as {
    meta?: { title: string; pause_ms: number; updated_ms: number } | null;
    lines?: DraftLine[];
  };
  try {
    const txid = await syncDraft(user.id, id, body.meta ?? null, (body.lines ?? []).slice(0, 500));
    return Response.json({ ok: true, txid }, { headers: noStore });
  } catch (e) {
    if ((e as Error).message === "NOT_FOUND")
      return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: noStore });
    throw e;
  }
}
