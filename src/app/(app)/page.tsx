import Link from "next/link";
import { connection } from "next/server";

import { requireSeededUser } from "@/lib/auth/server";
import { listConversations } from "@/lib/data";

import { newConversation } from "./actions";
import { DeleteConversation } from "./delete-conversation";

export default async function Home() {
  await connection();
  const user = await requireSeededUser();
  const convs = await listConversations(user.id);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Conversations</h1>
        <form action={newConversation.bind(null, true)}>
          <button className="btn">New from template</button>
        </form>
        <form action={newConversation.bind(null, false)}>
          <button className="btn btn-primary">New conversation</button>
        </form>
      </div>
      {convs.length === 0 ? (
        <p className="card p-6 text-sm text-muted">No conversations yet. Start from the template to see how it works.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {convs.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <Link href={`/conversations/${c.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.title}</p>
                <p className="text-xs text-muted">
                  {c.lines} lines · {c.versions === 0 ? "not converted yet" : `${c.versions} version${c.versions > 1 ? "s" : ""}`}
                </p>
              </Link>
              <DeleteConversation id={c.id} title={c.title} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
