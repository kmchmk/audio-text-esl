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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <h1 className="text-xl font-semibold sm:mr-auto">Conversations</h1>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <form action={newConversation.bind(null, true)}>
            <button className="btn w-full">New from template</button>
          </form>
          <form action={newConversation.bind(null, false)}>
            <button className="btn btn-primary w-full">New conversation</button>
          </form>
        </div>
      </div>
      {convs.length === 0 ? (
        <p className="card p-6 text-sm text-muted">No conversations yet. Start from the template to see how it works.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {convs.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2">
              <Link href={`/conversations/${c.id}`} className="min-w-0 flex-1 py-1">
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
