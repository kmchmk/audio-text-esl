import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { decode, durationMs, encodeMp3, stitch } from "./audio";
import { getConversation, getDraftLines, listCharacters } from "./data";
import { getDb, schema as s } from "./db";
import type { LineTiming, SnapshotLine } from "./db/schema";
import { isEmotion, type Emotion } from "./emotions";
import { env } from "./env";
import { getObject, putObject } from "./storage";
import { findModel } from "./tts/catalog";
import { cacheKey, effectiveSpec, synthesizeLine, type LineSpec } from "./tts";

export class UserError extends Error {}

/** Snapshot the draft as a new version and queue its generation. */
export async function startGeneration(userId: string, conversationId: string) {
  const db = getDb();
  const conv = await getConversation(userId, conversationId);
  if (!conv) throw new UserError("Conversation not found.");
  const lines = (await getDraftLines(userId, conversationId)).filter((l) => !l.deleted && l.text.trim());
  if (!lines.length) throw new UserError("Add at least one line with text first.");
  const chars = new Map((await listCharacters(userId, true)).map((c) => [c.id, c]));

  const snapshot: SnapshotLine[] = [];
  const specs: LineSpec[] = [];
  for (const [i, l] of lines.entries()) {
    const c = l.character_id ? chars.get(l.character_id) : undefined;
    if (!c) throw new UserError(`Line ${i + 1} has no speaker. Pick a character for it.`);
    const model = await findModel(c.provider, c.model);
    if (!model) throw new UserError(`${c.name}'s voice model (${c.model}) is no longer available. Pick another voice.`);
    const speed = l.speed ?? c.default_speed;
    const emotion: Emotion = isEmotion(l.emotion) ? l.emotion : "neutral";
    snapshot.push({ id: l.id, character_id: c.id, character_version_id: c.version_id, text: l.text.trim(), emotion, speed });
    specs.push(effectiveSpec({ provider: c.provider, model: c.model, voice: c.voice, text: l.text, emotion, speed }, model.emotion));
  }

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${s.conversation_versions.version}), 0) + 1` })
    .from(s.conversation_versions)
    .where(eq(s.conversation_versions.conversation_id, conversationId));
  const [version] = await db
    .insert(s.conversation_versions)
    .values({ conversation_id: conversationId, user_id: userId, version: next, title: conv.title, pause_ms: conv.pause_ms, lines: snapshot })
    .returning({ id: s.conversation_versions.id, version: s.conversation_versions.version });
  const [gen] = await db
    .insert(s.generations)
    .values({ conversation_id: conversationId, version_id: version.id, user_id: userId, total_items: snapshot.length })
    .returning({ id: s.generations.id });
  await db.insert(s.generation_items).values(
    snapshot.map((l, idx) => ({ generation_id: gen.id, idx, line_id: l.id, cache_key: cacheKey(specs[idx]) })),
  );
  return { generationId: gen.id, version: version.version };
}

/** Reset failed lines and queue the generation again. */
export async function retryGeneration(userId: string, generationId: string) {
  const db = getDb();
  const [g] = await db
    .update(s.generations)
    .set({ status: "queued", error: null, lease_until: null })
    .where(and(eq(s.generations.id, generationId), eq(s.generations.user_id, userId), eq(s.generations.status, "failed")))
    .returning({ id: s.generations.id });
  if (!g) return false;
  await db
    .update(s.generation_items)
    .set({ status: "pending", error: null })
    .where(and(eq(s.generation_items.generation_id, generationId), eq(s.generation_items.status, "failed")));
  return true;
}

const LEASE_SECONDS = 120;

/**
 * Work through a generation's lines until done or the time budget runs out. A lease row
 * lock keeps two invocations from working on the same generation. Returns "more" when the
 * caller should schedule another run.
 */
export async function processGeneration(generationId: string, budgetMs = 230_000): Promise<"done" | "more" | "busy" | "failed"> {
  const db = getDb();
  const started = Date.now();
  const [gen] = await db
    .update(s.generations)
    .set({ status: "running", lease_until: sql`now() + make_interval(secs => ${LEASE_SECONDS})` })
    .where(
      and(
        eq(s.generations.id, generationId),
        inArray(s.generations.status, ["queued", "running"]),
        sql`(${s.generations.lease_until} is null or ${s.generations.lease_until} < now())`,
      ),
    )
    .returning();
  if (!gen) return "busy";

  const [version] = await db.select().from(s.conversation_versions).where(eq(s.conversation_versions.id, gen.version_id));
  const cvs = await db
    .select()
    .from(s.character_versions)
    .where(inArray(s.character_versions.id, [...new Set(version.lines.map((l) => l.character_version_id))]));
  const cvById = new Map(cvs.map((c) => [c.id, c]));
  const items = await db
    .select()
    .from(s.generation_items)
    .where(eq(s.generation_items.generation_id, generationId))
    .orderBy(asc(s.generation_items.idx));

  try {
    for (const item of items) {
      if (item.status === "done") continue;
      if (Date.now() - started > budgetMs) {
        await db.update(s.generations).set({ lease_until: null }).where(eq(s.generations.id, generationId));
        return "more";
      }
      const line = version.lines[item.idx];
      const cv = cvById.get(line.character_version_id)!;
      let clip = (await db.select().from(s.clips).where(eq(s.clips.cache_key, item.cache_key)))[0];
      let cost = 0;
      const wasCached = !!clip;
      if (!clip) {
        const model = await findModel(cv.provider, cv.model);
        if (!model) throw new UserError(`Voice model ${cv.model} is no longer available.`);
        const spec = effectiveSpec(
          { provider: cv.provider, model: cv.model, voice: cv.voice, text: line.text, emotion: line.emotion as Emotion, speed: line.speed },
          model.emotion,
        );
        let out;
        try {
          out = await synthesizeLine(spec);
        } catch (e) {
          await db
            .update(s.generation_items)
            .set({ status: "failed", error: String((e as Error).message).slice(0, 500) })
            .where(eq(s.generation_items.id, item.id));
          throw new UserError(`Line ${item.idx + 1} (${cv.name}) failed: ${(e as Error).message}`);
        }
        const id = crypto.randomUUID();
        const key = `clips/${id}.mp3`;
        await putObject(key, await encodeMp3(out.pcm));
        cost = out.costUsd;
        const inserted = await db
          .insert(s.clips)
          .values({
            id,
            cache_key: item.cache_key,
            provider: spec.provider,
            model: spec.model,
            voice: spec.voice,
            text: spec.text,
            emotion: spec.emotion,
            speed: spec.speed,
            audio_key: key,
            duration_ms: durationMs(out.pcm),
            cost_usd: cost,
            provider_generation_id: out.providerGenerationId,
          })
          .onConflictDoNothing({ target: s.clips.cache_key })
          .returning();
        clip = inserted[0] ?? (await db.select().from(s.clips).where(eq(s.clips.cache_key, item.cache_key)))[0];
      }
      await db.batch([
        db
          .update(s.generation_items)
          .set({ status: "done", clip_id: clip.id, cached: wasCached, cost_usd: cost, error: null })
          .where(eq(s.generation_items.id, item.id)),
        db
          .update(s.generations)
          .set({
            done_items: sql`${s.generations.done_items} + 1`,
            cost_usd: sql`${s.generations.cost_usd} + ${cost}`,
            lease_until: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,
          })
          .where(eq(s.generations.id, generationId)),
      ]);
      item.status = "done";
      item.clip_id = clip.id;
    }
    await assemble(generationId, version.pause_ms);
    return "done";
  } catch (e) {
    const msg = e instanceof UserError ? e.message : `Unexpected error: ${(e as Error).message}`;
    console.error("[generation]", generationId, e);
    await db
      .update(s.generations)
      .set({ status: "failed", error: msg.slice(0, 1000), lease_until: null })
      .where(eq(s.generations.id, generationId));
    return "failed";
  }
}

/** Stitch the finished clips into one MP3 with the version's pause between lines. */
async function assemble(generationId: string, pauseMs: number) {
  const db = getDb();
  const rows = await db
    .select({ idx: s.generation_items.idx, line_id: s.generation_items.line_id, clip_id: s.clips.id, audio_key: s.clips.audio_key })
    .from(s.generation_items)
    .innerJoin(s.clips, eq(s.clips.id, s.generation_items.clip_id))
    .where(eq(s.generation_items.generation_id, generationId))
    .orderBy(asc(s.generation_items.idx));
  const pcms: Float32Array[] = [];
  for (const r of rows) pcms.push(await decode(await getObject(r.audio_key)));
  const { pcm, spans } = stitch(pcms, pauseMs);
  const key = `generations/${generationId}.mp3`;
  await putObject(key, await encodeMp3(pcm));
  const timings: LineTiming[] = rows.map((r, i) => ({ line_id: r.line_id, clip_id: r.clip_id, ...spans[i] }));
  await db
    .update(s.generations)
    .set({ status: "done", audio_key: key, duration_ms: durationMs(pcm), timings, finished_at: new Date(), lease_until: null })
    .where(eq(s.generations.id, generationId));
}

// ---------------------------------------------------------------- worker trigger

const sign = (id: string) => createHmac("sha256", env().workerSecret).update(id).digest("hex");

export function verifyWorkerSignature(id: string, sig: string) {
  const a = Buffer.from(sign(id));
  const b = Buffer.from(sig || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Ask the worker route to process a generation. It answers at once and works in the background. */
export async function triggerWorker(origin: string, generationId: string) {
  try {
    const res = await fetch(`${origin}/api/worker`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Lets the call through Vercel deployment protection when a bypass secret is configured.
        ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}),
      },
      body: JSON.stringify({ id: generationId, sig: sign(generationId) }),
    });
    if (!res.ok) console.warn("[worker trigger]", res.status, await res.text());
  } catch (e) {
    console.warn("[worker trigger]", e);
  }
}

// ---------------------------------------------------------------- history

export async function listGenerations(userId: string, conversationId: string) {
  const db = getDb();
  return db
    .select({
      id: s.generations.id,
      status: s.generations.status,
      total_items: s.generations.total_items,
      done_items: s.generations.done_items,
      cost_usd: s.generations.cost_usd,
      duration_ms: s.generations.duration_ms,
      error: s.generations.error,
      created_at: s.generations.created_at,
      lease_until: s.generations.lease_until,
      version_id: s.conversation_versions.id,
      version: s.conversation_versions.version,
      title: s.conversation_versions.title,
      pause_ms: s.conversation_versions.pause_ms,
      lines: s.conversation_versions.lines,
      timings: s.generations.timings,
    })
    .from(s.generations)
    .innerJoin(s.conversation_versions, eq(s.conversation_versions.id, s.generations.version_id))
    .where(and(eq(s.generations.conversation_id, conversationId), eq(s.generations.user_id, userId)))
    .orderBy(desc(s.generations.created_at));
}
