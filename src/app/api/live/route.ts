import { requireUser } from "@/lib/auth/server";
import { getConversation } from "@/lib/data";
import { sealLive, type LiveKind } from "@/lib/live";

const noStore = { "Cache-Control": "private, no-store" };
const KINDS: LiveKind[] = ["draft", "meta", "generations"];

/** Seals (and renews) a live query for the signed-in teacher's conversation. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { kind, conversationId } = (await req.json()) as { kind: LiveKind; conversationId: string };
  if (!KINDS.includes(kind)) return Response.json({ error: "BAD_KIND" }, { status: 400, headers: noStore });
  if (!(await getConversation(user.id, conversationId)))
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: noStore });
  return Response.json(await sealLive(kind, user.id, conversationId), { headers: noStore });
}
