import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Column names are snake_case and match the JS property names, because Neon Realtime
// returns live rows keyed by PostgreSQL column names.

/** Per-teacher settings (first-run tutorial, template seeding). */
export const user_settings = pgTable("user_settings", {
  user_id: uuid("user_id").primaryKey(),
  seeded_at: timestamp("seeded_at", { withTimezone: true }),
  tutorial_done_at: timestamp("tutorial_done_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A teacher's character. Its properties live in immutable character_versions rows. */
export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    current_version_id: uuid("current_version_id"),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("characters_user_idx").on(t.user_id)],
);

export const character_versions = pgTable(
  "character_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    character_id: uuid("character_id").notNull(),
    user_id: uuid("user_id").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    gender: text("gender").notNull(), // female | male | neutral
    age_group: text("age_group").notNull(), // child | teen | young_adult | adult | senior
    accent: text("accent").notNull(), // e.g. "American", "British"
    provider: text("provider").notNull(), // supertonic | openrouter
    model: text("model").notNull(),
    voice: text("voice").notNull(),
    default_speed: doublePrecision("default_speed").notNull().default(1),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("character_versions_char_ver_idx").on(t.character_id, t.version)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey(),
    user_id: uuid("user_id").notNull(),
    title: text("title").notNull(),
    pause_ms: integer("pause_ms").notNull().default(500),
    // client clock (ms) of the last edit to title/pause, for last-write-wins merging
    updated_ms: doublePrecision("updated_ms").notNull(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_user_idx").on(t.user_id)],
);

/** Editable draft lines. Rows are soft-deleted (tombstones) so offline devices merge cleanly. */
export const draft_lines = pgTable(
  "draft_lines",
  {
    id: uuid("id").primaryKey(), // created in the browser
    conversation_id: uuid("conversation_id").notNull(),
    user_id: uuid("user_id").notNull(),
    position: doublePrecision("position").notNull(),
    character_id: uuid("character_id"),
    text: text("text").notNull().default(""),
    emotion: text("emotion").notNull().default("neutral"),
    speed: doublePrecision("speed"), // null = character default
    deleted: boolean("deleted").notNull().default(false),
    updated_ms: doublePrecision("updated_ms").notNull(),
  },
  (t) => [index("draft_lines_conv_idx").on(t.conversation_id)],
);

export type SnapshotLine = {
  id: string;
  character_id: string;
  character_version_id: string;
  text: string;
  emotion: string;
  speed: number;
};

/** Immutable snapshot of a conversation, created on every "Convert to audio". */
export const conversation_versions = pgTable(
  "conversation_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversation_id: uuid("conversation_id").notNull(),
    user_id: uuid("user_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    pause_ms: integer("pause_ms").notNull(),
    lines: jsonb("lines").$type<SnapshotLine[]>().notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("conversation_versions_conv_ver_idx").on(t.conversation_id, t.version)],
);

export type LineTiming = { line_id: string; start_ms: number; end_ms: number; clip_id: string };

export const generations = pgTable(
  "generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversation_id: uuid("conversation_id").notNull(),
    version_id: uuid("version_id").notNull(),
    user_id: uuid("user_id").notNull(),
    status: text("status").notNull().default("queued"), // queued | running | done | failed
    total_items: integer("total_items").notNull(),
    done_items: integer("done_items").notNull().default(0),
    cost_usd: doublePrecision("cost_usd").notNull().default(0),
    audio_key: text("audio_key"),
    duration_ms: integer("duration_ms"),
    timings: jsonb("timings").$type<LineTiming[]>(),
    error: text("error"),
    lease_until: timestamp("lease_until", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finished_at: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("generations_conv_idx").on(t.conversation_id)],
);

/** One line of a generation; points at a (possibly cached) clip. */
export const generation_items = pgTable(
  "generation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generation_id: uuid("generation_id").notNull(),
    idx: integer("idx").notNull(),
    line_id: uuid("line_id").notNull(),
    cache_key: text("cache_key").notNull(),
    status: text("status").notNull().default("pending"), // pending | done | failed
    clip_id: uuid("clip_id"),
    cached: boolean("cached").notNull().default(false),
    cost_usd: doublePrecision("cost_usd").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("generation_items_gen_idx").on(t.generation_id)],
);

/** A synthesized line, cached by everything that affects the audio. */
export const clips = pgTable("clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  cache_key: text("cache_key").notNull().unique(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  voice: text("voice").notNull(),
  text: text("text").notNull(),
  emotion: text("emotion").notNull(),
  speed: doublePrecision("speed").notNull(),
  audio_key: text("audio_key").notNull(),
  duration_ms: integer("duration_ms").notNull(),
  cost_usd: doublePrecision("cost_usd").notNull().default(0),
  provider_generation_id: text("provider_generation_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shares = pgTable(
  "shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    user_id: uuid("user_id").notNull(),
    generation_id: uuid("generation_id").notNull(),
    hide_transcript: boolean("hide_transcript").notNull().default(false),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shares_generation_idx").on(t.generation_id)],
);
