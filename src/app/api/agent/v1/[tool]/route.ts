import { runTool } from "@/lib/agent/tools";

export const maxDuration = 120;

/** REST form of every agent tool: POST /api/agent/v1/<tool> with a JSON body of arguments. */
export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  let args: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      args = JSON.parse(text);
    } catch {
      return Response.json({ error: "Body must be JSON." }, { status: 400 });
    }
  }
  const r = await runTool(req, tool, args);
  return r.ok ? Response.json(r.result) : Response.json({ error: r.error }, { status: r.status });
}
