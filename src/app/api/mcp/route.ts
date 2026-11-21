import { runTool, toolSchemas } from "@/lib/agent/tools";

// Minimal stateless MCP server (Streamable HTTP, JSON responses). Tools are the same as the
// REST API at /api/agent/v1. Authenticate with `Authorization: Bearer <key>`.
export const maxDuration = 120;

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const INSTRUCTIONS =
  "ESL Listening Studio: teachers write conversations and turn them into listening audio. Connect with request_login_code then verify_login_code (the teacher gets a code by email), and send the returned key as 'Authorization: Bearer <key>'. Full guide: GET /agent on this server.";

async function handle(req: Request, msg: RpcRequest) {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: (msg.params?.protocolVersion as string) || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "esl-listening-studio", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: toolSchemas().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const r = await runTool(req, name, msg.params?.arguments ?? {});
      if (!r.ok) return reply({ content: [{ type: "text", text: r.error }], isError: true });
      return reply({ content: [{ type: "text", text: JSON.stringify(r.result, null, 2) }], structuredContent: r.result, isError: false });
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  let body: RpcRequest | RpcRequest[];
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const batch = Array.isArray(body) ? body : [body];
  const out = [];
  for (const m of batch) {
    if (m.id === undefined || m.method?.startsWith("notifications/")) continue; // notifications get no reply
    out.push(await handle(req, m));
  }
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? out : out[0]);
}

export function GET() {
  return new Response("This MCP server answers JSON-RPC over POST (no SSE stream).", { status: 405, headers: { Allow: "POST" } });
}
