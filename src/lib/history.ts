import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { getCharacterVersions, listCharacters } from "./data";
import { getDb, schema as s } from "./db";
import { listGenerations } from "./generation";
import { signedUrl } from "./storage";

export type CharacterChange = { field: string; then: string; now: string };

export type HistoryLine = {
  id: string;
  text: string;
  emotion: string;
  speed: number;
  character: string;
  character_id: string;
  start_ms: number | null;
  end_ms: number | null;
  clip_url: string | null;
};

export type HistoryEntry = {
  id: string;
  version: number;
  title: string;
  status: string;
  done_items: number;
  total_items: number;
  cost_usd: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  stalled: boolean;
  pause_ms: number;
  audio_url: string | null;
  download_url: string | null;
  lines: HistoryLine[];
  characters: { name: string; version: number; voice: string; changes: CharacterChange[]; deleted: boolean }[];
  shares: { token: string; hide_transcript: boolean }[];
};

const FIELDS = [
  ["name", "Name"],
  ["voice", "Voice"],
  ["model", "Model"],
  ["accent", "Accent"],
  ["gender", "Gender"],
  ["age_group", "Age"],
  ["default_speed", "Default speed"],
] as const;

const slug = (t: string) => t.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "conversation";

export async function conversationHistory(userId: string, conversationId: string): Promise<HistoryEntry[]> {
  const gens = await listGenerations(userId, conversationId);
  if (!gens.length) return [];
  const versionIds = [...new Set(gens.flatMap((g) => g.lines.map((l) => l.character_version_id)))];
  const used = new Map((await getCharacterVersions(userId, versionIds)).map((v) => [v.id, v]));
  const current = new Map((await listCharacters(userId, true)).map((c) => [c.id, c]));
  const deleted = new Set(
    (
      await getDb()
        .select({ id: s.characters.id, deleted_at: s.characters.deleted_at })
        .from(s.characters)
        .where(eq(s.characters.user_id, userId))
    )
      .filter((c) => c.deleted_at)
      .map((c) => c.id),
  );
  const shares = await getDb()
    .select()
    .from(s.shares)
    .where(and(eq(s.shares.user_id, userId), inArray(s.shares.generation_id, gens.map((g) => g.id)), isNull(s.shares.revoked_at)));
  const clipRows = await getDb()
    .select({ id: s.clips.id, audio_key: s.clips.audio_key })
    .from(s.clips)
    .where(inArray(s.clips.id, [...new Set(gens.flatMap((g) => (g.timings ?? []).map((t) => t.clip_id)))].concat(["00000000-0000-0000-0000-000000000000"])));
  const clipKey = new Map(clipRows.map((c) => [c.id, c.audio_key]));

  return Promise.all(
    gens.map(async (g) => {
      const name = slug(g.title);
      const timing = new Map((g.timings ?? []).map((t) => [t.line_id, t]));
      const charIds = [...new Set(g.lines.map((l) => l.character_version_id))];
      const lines: HistoryLine[] = await Promise.all(
        g.lines.map(async (l, i) => {
          const t = timing.get(l.id);
          const key = t ? clipKey.get(t.clip_id) : undefined;
          return {
            id: l.id,
            text: l.text,
            emotion: l.emotion,
            speed: l.speed,
            character: used.get(l.character_version_id)?.name ?? "Unknown",
            character_id: l.character_id,
            start_ms: t?.start_ms ?? null,
            end_ms: t?.end_ms ?? null,
            clip_url: key ? await signedUrl(key, `${name}-v${g.version}-line-${i + 1}.mp3`) : null,
          };
        }),
      );
      return {
        id: g.id,
        version: g.version,
        title: g.title,
        status: g.status,
        done_items: g.done_items,
        total_items: g.total_items,
        cost_usd: g.cost_usd,
        duration_ms: g.duration_ms,
        error: g.error,
        created_at: g.created_at.toISOString(),
        stalled: (g.status === "queued" || g.status === "running") && (!g.lease_until || g.lease_until.getTime() < Date.now() - 5000),
        pause_ms: g.pause_ms,
        audio_url: g.status === "done" ? await signedUrl(`generations/${g.id}.mp3`) : null,
        download_url: g.status === "done" ? await signedUrl(`generations/${g.id}.mp3`, `${name}-v${g.version}.mp3`) : null,
        lines,
        characters: charIds.map((vid) => {
          const then = used.get(vid)!;
          const now = current.get(then.character_id);
          const changes: CharacterChange[] =
            now && now.version_id !== vid
              ? FIELDS.filter(([k]) => String(then[k]) !== String(now[k])).map(([k, label]) => ({
                  field: label,
                  then: String(then[k]),
                  now: String(now[k]),
                }))
              : [];
          return { name: then.name, version: then.version, voice: `${then.model} · ${then.voice}`, changes, deleted: deleted.has(then.character_id) };
        }),
        shares: shares.filter((x) => x.generation_id === g.id).map((x) => ({ token: x.token, hide_transcript: x.hide_transcript })),
      };
    }),
  );
}
