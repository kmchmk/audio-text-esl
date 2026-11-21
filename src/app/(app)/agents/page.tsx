import { headers } from "next/headers";
import { connection } from "next/server";

import { listAgentKeys } from "@/lib/agent/keys";
import { requireSeededUser } from "@/lib/auth/server";

import { AgentRow, CopyLink } from "./agent-ui";

export default async function AgentsPage() {
  await connection();
  const user = await requireSeededUser();
  const keys = await listAgentKeys(user.id);
  const h = await headers();
  const origin = process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const link = `${origin}/agent`;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">AI agents</h1>
        <p className="text-sm text-muted">Use the app by chatting with your own AI assistant (for example on WhatsApp) instead of the website.</p>
      </div>

      <section className="card space-y-3 p-4">
        <p className="font-medium">Connect an assistant</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Send this link to your AI assistant and ask it to connect to ESL Listening Studio for you.</li>
          <li>It will ask for your email. We then email you a sign-in code.</li>
          <li>Give the assistant the code. That&apos;s it: it can now do everything you can do here and send you audio and PDFs.</li>
        </ol>
        <CopyLink link={link} />
        <p className="text-xs text-muted">
          Assistants can spend the shared budget on paid voices, just like you can on the website. Each one stays connected until you revoke it
          below.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Connected agents</h2>
        {keys.length === 0 ? (
          <p className="card p-4 text-sm text-muted">No agents connected yet.</p>
        ) : (
          <ul className="card divide-y divide-line">
            {keys.map((k) => (
              <AgentRow
                key={k.id}
                id={k.id}
                name={k.name}
                prefix={k.key_prefix}
                created={k.created_at.toISOString()}
                lastUsed={k.last_used_at?.toISOString() ?? null}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
