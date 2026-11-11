import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema as s } from "./db";
import { isEmotion } from "./emotions";
import { TEMPLATE_CHARACTERS, TEMPLATE_LINES, TEMPLATE_TITLE } from "./template";

export type CharacterView = {
  id: string;
  version_id: string;
  version: number;
  name: string;
  gender: string;
  age_group: string;
  accent: string;
  provider: string;
  model: string;
  voice: string;
  default_speed: number;
};

export type DraftLine = {
  id: string;
  position: number;
  character_id: string | null;
  text: string;
  emotion: string;
  speed: number | null;
  deleted: boolean;
  updated_ms: number;
};

export type ConversationMeta = { id: string; title: string; pause_ms: number; updated_ms: number };

const txid = sql<string>`pg_current_xact_id()::text`;

// ---------------------------------------------------------------- seeding

/** First visit: create settings, the four template characters and the template conversation. */
export async function ensureSeeded(userId: string) {
  const db = getDb();
  const [row] = await db
    .insert(s.user_settings)
    .values({ user_id: userId, seeded_at: new Date() })
    .onConflictDoNothing()
    .returning({ user_id: s.user_settings.user_id });
  if (!row) return; // already seeded
  const ids: Record<string, string> = {};
  for (const c of TEMPLATE_CHARACTERS) {
    ids[c.key] = await createCharacter(userId, {
      name: c.name,
      gender: c.gender,
      age_group: c.age_group,
      accent: c.accent,
      provider: "supertonic",
      model: "supertonic-3",
      voice: c.voice,
      default_speed: 1,
    });
  }
  await createConversation(userId, { template: true, characterIds: ids });
}

export async function getSettings(userId: string) {
  const [row] = await getDb().select().from(s.user_settings).where(eq(s.user_settings.user_id, userId));
  return row;
}

export async function markTutorialDone(userId: string, done: boolean) {
  await getDb()
    .update(s.user_settings)
    .set({ tutorial_done_at: done ? new Date() : null })
    .where(eq(s.user_settings.user_id, userId));
}

// ---------------------------------------------------------------- characters

export type CharacterInput = Omit<CharacterView, "id" | "version_id" | "version">;

export async function createCharacter(userId: string, input: CharacterInput): Promise<string> {
  const db = getDb();
  const [c] = await db.insert(s.characters).values({ user_id: userId }).returning({ id: s.characters.id });
  const [v] = await db
    .insert(s.character_versions)
    .values({ ...input, character_id: c.id, user_id: userId, version: 1 })
    .returning({ id: s.character_versions.id });
  await db.update(s.characters).set({ current_version_id: v.id }).where(eq(s.characters.id, c.id));
  return c.id;
}

/** Editing a character never changes history: it adds a version and points the character at it. */
export async function updateCharacter(userId: string, characterId: string, input: CharacterInput) {
  const db = getDb();
  const current = (await listCharacters(userId)).find((c) => c.id === characterId);
  if (!current) throw new Error("Character not found");
  const same = (Object.keys(input) as (keyof CharacterInput)[]).every((k) => input[k] === current[k]);
  if (same) return;
  const [v] = await db
    .insert(s.character_versions)
    .values({ ...input, character_id: characterId, user_id: userId, version: current.version + 1 })
    .returning({ id: s.character_versions.id });
  await db
    .update(s.characters)
    .set({ current_version_id: v.id })
    .where(and(eq(s.characters.id, characterId), eq(s.characters.user_id, userId)));
}

export async function deleteCharacter(userId: string, characterId: string) {
  await getDb()
    .update(s.characters)
    .set({ deleted_at: new Date() })
    .where(and(eq(s.characters.id, characterId), eq(s.characters.user_id, userId)));
}

export async function listCharacters(userId: string, includeDeleted = false): Promise<CharacterView[]> {
  const rows = await getDb()
    .select({
      id: s.characters.id,
      version_id: s.character_versions.id,
      version: s.character_versions.version,
      name: s.character_versions.name,
      gender: s.character_versions.gender,
      age_group: s.character_versions.age_group,
      accent: s.character_versions.accent,
      provider: s.character_versions.provider,
      model: s.character_versions.model,
      voice: s.character_versions.voice,
      default_speed: s.character_versions.default_speed,
      deleted_at: s.characters.deleted_at,
      created_at: s.characters.created_at,
    })
    .from(s.characters)
    .innerJoin(s.character_versions, eq(s.character_versions.id, s.characters.current_version_id))
    .where(and(eq(s.characters.user_id, userId), includeDeleted ? undefined : isNull(s.characters.deleted_at)))
    .orderBy(asc(s.characters.created_at));
  return rows.map(({ deleted_at: _d, created_at: _c, ...r }) => r);
}

export async function getCharacterVersions(userId: string, versionIds: string[]) {
  if (!versionIds.length) return [];
  return getDb()
    .select()
    .from(s.character_versions)
    .where(and(eq(s.character_versions.user_id, userId), inArray(s.character_versions.id, versionIds)));
}

// ---------------------------------------------------------------- conversations

export async function createConversation(
  userId: string,
  opts: { template?: boolean; characterIds?: Record<string, string> } = {},
): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(s.conversations).values({
    id,
    user_id: userId,
    title: opts.template ? TEMPLATE_TITLE : "Untitled conversation",
    pause_ms: 500,
    updated_ms: now,
  });
  let lines: (typeof s.draft_lines.$inferInsert)[];
  if (opts.template) {
    let ids = opts.characterIds;
    if (!ids) {
      // Re-use the teacher's characters with the template names when they still exist.
      const chars = await listCharacters(userId);
      ids = {};
      for (const t of TEMPLATE_CHARACTERS) {
        const found = chars.find((c) => c.name.toLowerCase() === t.name.toLowerCase());
        ids[t.key] =
          found?.id ??
          (await createCharacter(userId, { ...t, provider: "supertonic", model: "supertonic-3", default_speed: 1 }));
      }
    }
    lines = TEMPLATE_LINES.map((l, i) => ({
      id: crypto.randomUUID(),
      conversation_id: id,
      user_id: userId,
      position: i + 1,
      character_id: ids![l.who],
      text: l.text,
      emotion: l.emotion,
      updated_ms: now,
    }));
  } else {
    const first = (await listCharacters(userId))[0];
    lines = [{ id: crypto.randomUUID(), conversation_id: id, user_id: userId, position: 1, character_id: first?.id ?? null, text: "", updated_ms: now }];
  }
  await db.insert(s.draft_lines).values(lines);
  return id;
}

export async function listConversations(userId: string) {
  return getDb()
    .select({
      id: s.conversations.id,
      title: s.conversations.title,
      created_at: s.conversations.created_at,
      lines: sql<number>`(select count(*)::int from draft_lines d where d.conversation_id = conversations.id and not d.deleted)`,
      versions: sql<number>`(select count(*)::int from conversation_versions v where v.conversation_id = conversations.id)`,
    })
    .from(s.conversations)
    .where(and(eq(s.conversations.user_id, userId), isNull(s.conversations.deleted_at)))
    .orderBy(desc(s.conversations.created_at));
}

export async function getConversation(userId: string, id: string): Promise<ConversationMeta | null> {
  const [c] = await getDb()
    .select({ id: s.conversations.id, title: s.conversations.title, pause_ms: s.conversations.pause_ms, updated_ms: s.conversations.updated_ms })
    .from(s.conversations)
    .where(and(eq(s.conversations.id, id), eq(s.conversations.user_id, userId), isNull(s.conversations.deleted_at)));
  return c ?? null;
}

export async function getDraftLines(userId: string, conversationId: string): Promise<DraftLine[]> {
  return getDb()
    .select({
      id: s.draft_lines.id,
      position: s.draft_lines.position,
      character_id: s.draft_lines.character_id,
      text: s.draft_lines.text,
      emotion: s.draft_lines.emotion,
      speed: s.draft_lines.speed,
      deleted: s.draft_lines.deleted,
      updated_ms: s.draft_lines.updated_ms,
    })
    .from(s.draft_lines)
    .where(and(eq(s.draft_lines.conversation_id, conversationId), eq(s.draft_lines.user_id, userId)))
    .orderBy(asc(s.draft_lines.position));
}

export async function deleteConversation(userId: string, id: string) {
  await getDb()
    .update(s.conversations)
    .set({ deleted_at: new Date() })
    .where(and(eq(s.conversations.id, id), eq(s.conversations.user_id, userId)));
}

/**
 * Apply edits from a device. Each row only overwrites the stored one when it is newer
 * (last write wins per line, by the editing device's clock), so replays and stale offline
 * edits are harmless. Returns the transaction id for Realtime's awaitTxId.
 */
export async function syncDraft(
  userId: string,
  conversationId: string,
  meta: { title: string; pause_ms: number; updated_ms: number } | null,
  lines: DraftLine[],
): Promise<string | null> {
  const db = getDb();
  if (!(await getConversation(userId, conversationId))) throw new Error("NOT_FOUND");
  const owned = await getDb()
    .select({ id: s.characters.id })
    .from(s.characters)
    .where(eq(s.characters.user_id, userId));
  const ownedIds = new Set(owned.map((o) => o.id));
  let last: string | null = null;
  if (meta) {
    const [r] = await db
      .update(s.conversations)
      .set({ title: meta.title.slice(0, 200) || "Untitled conversation", pause_ms: clampInt(meta.pause_ms, 0, 5000), updated_ms: meta.updated_ms })
      .where(and(eq(s.conversations.id, conversationId), eq(s.conversations.user_id, userId), sql`${s.conversations.updated_ms} < ${meta.updated_ms}`))
      .returning({ txid });
    last = r?.txid ?? last;
  }
  if (lines.length) {
    const values = lines.map((l) => ({
      id: l.id,
      conversation_id: conversationId,
      user_id: userId,
      position: Number(l.position) || 0,
      character_id: l.character_id && ownedIds.has(l.character_id) ? l.character_id : null,
      text: String(l.text ?? "").slice(0, 2000),
      emotion: isEmotion(l.emotion) ? l.emotion : "neutral",
      speed: l.speed == null ? null : Math.min(1.6, Math.max(0.6, Number(l.speed))),
      deleted: !!l.deleted,
      updated_ms: Number(l.updated_ms) || Date.now(),
    }));
    const rows = await db
      .insert(s.draft_lines)
      .values(values)
      .onConflictDoUpdate({
        target: s.draft_lines.id,
        set: {
          position: sql`excluded.position`,
          character_id: sql`excluded.character_id`,
          text: sql`excluded.text`,
          emotion: sql`excluded.emotion`,
          speed: sql`excluded.speed`,
          deleted: sql`excluded.deleted`,
          updated_ms: sql`excluded.updated_ms`,
        },
        // Only newer edits win, and only on the caller's own rows in this conversation.
        setWhere: sql`${s.draft_lines.updated_ms} < excluded.updated_ms and ${s.draft_lines.user_id} = ${userId} and ${s.draft_lines.conversation_id} = ${conversationId}`,
      })
      .returning({ txid });
    last = rows[0]?.txid ?? last;
  }
  return last;
}

const clampInt = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, Number(v) || 0)));
