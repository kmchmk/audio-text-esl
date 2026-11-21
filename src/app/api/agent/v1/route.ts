import { toolSchemas } from "@/lib/agent/tools";

/** Machine-readable list of agent tools with JSON Schemas for their arguments. */
export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return Response.json({
    guide: `${origin}/agent`,
    mcp_endpoint: `${origin}/api/mcp`,
    call: `POST ${origin}/api/agent/v1/<tool name> with a JSON body; header 'Authorization: Bearer <key>' except for the sign-in tools.`,
    tools: toolSchemas(),
  });
}
