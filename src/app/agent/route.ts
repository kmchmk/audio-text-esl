import { toolSchemas } from "@/lib/agent/tools";

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; enum?: unknown[]; items?: JsonSchema; description?: string; anyOf?: JsonSchema[] };

function typeOf(s: JsonSchema): string {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.anyOf) return s.anyOf.map(typeOf).join(" | ");
  if (s.type === "array") return `${s.items ? typeOf(s.items) : "any"}[]`;
  if (s.type === "object" && s.properties) return `{ ${Object.entries(s.properties).map(([k, v]) => `${k}: ${typeOf(v)}`).join(", ")} }`;
  return Array.isArray(s.type) ? s.type.join(" | ") : (s.type ?? "any");
}

function args(schema: JsonSchema) {
  const props = Object.entries(schema.properties ?? {});
  if (!props.length) return "  (no arguments)";
  const req = new Set(schema.required ?? []);
  return props.map(([k, v]) => `  - \`${k}\`${req.has(k) ? "" : " (optional)"}: ${typeOf(v)}${v.description ? `. ${v.description}` : ""}`).join("\n");
}

/** The link teachers give their AI agent: everything an agent needs, in plain Markdown. */
export function GET(req: Request) {
  const o = new URL(req.url).origin;
  const tools = toolSchemas();
  const md = `# ESL Listening Studio: guide for AI agents

You are helping an English teacher use **ESL Listening Studio** (${o}). Teachers write conversations, choose a character (voice) for each line, and convert them into audio for listening practice and tests. You can do everything the website does for the teacher's account and send the results (MP3 audio, PDFs, share links) back to them in your chat.

## 1. Connect (once)

1. Ask the teacher for the email they use with the app.
2. Call \`request_login_code\` with that email. The app emails them a sign-in code.
3. Ask the teacher for the code (or read it from their inbox if you have access), then call \`verify_login_code\` with the email, the code and a short \`agent_name\` (for example "WhatsApp assistant").
4. You receive an \`api_key\` (starts with \`esl_\`). Store it securely. It stays valid until the teacher revokes it on the website (${o}/agents). Send it on every other call as the header \`Authorization: Bearer <api_key>\`.

If the email is not on the allowed list, the teacher must ask the app's administrator to add it. A teacher who has never used the website gets an account automatically when they sign in this way.

## 2. How to call tools

Two equivalent ways; use whichever your platform supports:

- **MCP** (Model Context Protocol, Streamable HTTP, JSON responses): \`${o}/api/mcp\`. \`tools/list\` and \`tools/call\` as usual.
- **HTTP**: \`POST ${o}/api/agent/v1/<tool name>\` with a JSON object of arguments as the body. Results are JSON; errors are \`{ "error": "…" }\` with a 4xx/5xx status. JSON Schemas for all tools: \`GET ${o}/api/agent/v1\`.

## 3. Things to know

- **Costs.** Free voices (Supertonic) cost nothing. Paid voices draw from one budget shared by all teachers, reported in USD and Thai baht (\`get_account\`). \`estimate_cost\` gives the expected cost before converting; lines that haven't changed are reused for free. Each version reports its actual cost. You decide whether to tell the teacher before spending.
- **Voices.** Free voices are adults only. Child voices: MiniMax (several girls, one boy, teens) and Fish Audio (one girl, about 8; no boy voice exists there). Each service in \`list_voice_services\` includes plain-language \`notes\`; relay them when relevant.
- **Emotions.** Each line has an emotion, but only voices with \`supports_emotions: true\` act it out. Otherwise it's read neutrally (\`emotion_will_be_used\` in \`get_conversation\`).
- **Versions.** \`convert_to_audio\` snapshots the conversation as a new version and returns a \`generation_id\`. Audio takes about 1–3 minutes: poll \`get_version\` every 10–15 seconds until \`status\` is \`done\` (or \`failed\`: show the error, or \`retry_version\`). Changing a character later doesn't change old versions; \`voices_used[].changed_since\` lists what changed.
- **Sending files to the teacher.** \`audio_mp3_url\` (whole conversation), \`line_mp3_url\` (each line) and \`pdf_url\` (\`get_pdf\`: script or gap-fill worksheet) are direct download links valid for 24 hours. Download the file and send it as audio or a document in your chat, or send the link. Call the tool again for a fresh link.
- **Students.** \`create_share_link\` gives a public page students can open without signing in, optionally without the transcript (for tests). \`revoke_share_link\` turns it off.
- **The website stays in sync.** Changes you make appear live in the teacher's open browser tabs, and the teacher's own edits appear in your next \`get_conversation\`.
- **New accounts** start with four characters (Dad, Mom, Son, Daughter on free adult voices) and a 16-line "Family dinner" template conversation.

## 4. Tools

${tools
  .map(
    (t) => `### \`${t.name}\`${t.requires_access_key ? "" : " (no access key needed)"}
${t.description}
${args(t.inputSchema as JsonSchema)}`,
  )
  .join("\n\n")}
`;
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
