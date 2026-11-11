import "server-only";

import { createRealtime, rawSql, type RawSqlQuery, type SealedLiveQuery } from "@neon/realtime/server";

import type { ConversationMeta, DraftLine } from "./data";
import { env } from "./env";

let rt: ReturnType<typeof createRealtime> | undefined;
const realtime = () =>
  (rt ??= createRealtime({ secret: env().realtimeSecret, db: "neondb", debugMode: process.env.NODE_ENV === "development" }));

export type LiveGeneration = {
  id: string;
  status: string;
  done_items: number;
  total_items: number;
  cost_usd: number;
};

export type LiveKind = "draft" | "meta" | "generations";

// Every live query is scoped by the session user's id, which only ever comes from getUser().
const QUERIES = {
  draft: (userId: string, conversationId: string) =>
    rawSql<DraftLine>(
      `select id::text, position, character_id::text, text, emotion, speed, deleted, updated_ms
         from draft_lines where conversation_id = $1::uuid and user_id = $2::uuid order by position, id`,
      [conversationId, userId],
    ),
  meta: (userId: string, conversationId: string) =>
    rawSql<ConversationMeta>(
      `select id::text, title, pause_ms, updated_ms from conversations where id = $1::uuid and user_id = $2::uuid`,
      [conversationId, userId],
    ),
  generations: (userId: string, conversationId: string) =>
    rawSql<LiveGeneration>(
      `select id::text, status, done_items, total_items, cost_usd
         from generations where conversation_id = $1::uuid and user_id = $2::uuid order by created_at desc`,
      [conversationId, userId],
    ),
};

type Rows = { draft: DraftLine; meta: ConversationMeta; generations: LiveGeneration };

export function sealLive<K extends LiveKind>(kind: K, userId: string, conversationId: string): Promise<SealedLiveQuery<Rows[K]>> {
  const query = QUERIES[kind](userId, conversationId) as RawSqlQuery<Rows[K]>;
  return realtime().seal({ query });
}

export const realtimeUrl = () => env().realtimeUrl;
