import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { signOut } from "../auth/actions";
import { getSeededUser } from "@/lib/auth/server";
import { getSettings } from "@/lib/data";

import { BudgetPill } from "./budget-pill";
import { Tutorial } from "./tutorial";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const user = await getSeededUser();
  if (!user) redirect("/auth/sign-in");
  const settings = await getSettings(user.id);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <Link href="/" className="font-semibold">
            ESL Listening Studio
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="text-muted hover:text-fg" data-tour="conversations">
              Conversations
            </Link>
            <Link href="/characters" className="text-muted hover:text-fg" data-tour="characters">
              Characters
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <BudgetPill />
            <Tutorial initiallyOpen={!settings?.tutorial_done_at} />
            <form action={signOut}>
              <button className="text-muted hover:text-fg" title={user.email}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
