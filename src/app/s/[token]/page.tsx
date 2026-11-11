import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { connection } from "next/server";

import { Player } from "@/components/player";
import { getDb, schema as s } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Listening practice", robots: { index: false } };

/** Public, read-only player for one shared version. Revoked links show a notice. */
export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const db = getDb();
  const [row] = await db
    .select({ share: s.shares, gen: s.generations, version: s.conversation_versions })
    .from(s.shares)
    .innerJoin(s.generations, eq(s.generations.id, s.shares.generation_id))
    .innerJoin(s.conversation_versions, eq(s.conversation_versions.id, s.generations.version_id))
    .where(and(eq(s.shares.token, token), isNull(s.shares.revoked_at), eq(s.generations.status, "done")));

  if (!row) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">This link isn&apos;t available</h1>
        <p className="mt-2 text-sm text-muted">It may have been switched off by the teacher. Ask them for a new link.</p>
      </main>
    );
  }
  const { share, gen, version } = row;
  const cvs = await db
    .select({ id: s.character_versions.id, name: s.character_versions.name })
    .from(s.character_versions)
    .where(inArray(s.character_versions.id, [...new Set(version.lines.map((l) => l.character_version_id))]));
  const names = new Map(cvs.map((c) => [c.id, c.name]));
  const timing = new Map((gen.timings ?? []).map((t) => [t.line_id, t]));
  const lines = version.lines.map((l) => ({
    character: names.get(l.character_version_id) ?? "Speaker",
    text: l.text,
    start_ms: timing.get(l.id)?.start_ms ?? null,
    end_ms: timing.get(l.id)?.end_ms ?? null,
  }));
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      <div>
        <p className="text-sm text-muted">Listening practice</p>
        <h1 className="text-2xl font-semibold">{version.title}</h1>
      </div>
      <div className="card p-4">
        <Player src={await signedUrl(gen.audio_key!, undefined, 6 * 3600)} lines={lines} hideTranscript={share.hide_transcript} />
      </div>
    </main>
  );
}
