import { requireUser } from "@/lib/auth/server";
import { getConversation } from "@/lib/data";
import { conversationHistory } from "@/lib/history";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!(await getConversation(user.id, id))) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  return Response.json(await conversationHistory(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
}
