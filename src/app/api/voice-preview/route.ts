import { eq } from "drizzle-orm";

import { encodeMp3, durationMs } from "@/lib/audio";
import { requireUser } from "@/lib/auth/server";
import { getDb, schema as s } from "@/lib/db";
import { isEmotion } from "@/lib/emotions";
import { putObject, signedUrl } from "@/lib/storage";
import { findModel } from "@/lib/tts/catalog";
import { cacheKey, effectiveSpec, synthesizeLine } from "@/lib/tts";

export const maxDuration = 300;

const SAMPLE = "Hi there! This is how I sound when I read your conversation.";

/** Speak a short sample with a voice (cached, so each voice is only paid for once). */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = (await req.json()) as { provider: string; model: string; voice: string; speed?: number; emotion?: string; text?: string };
  const model = await findModel(b.provider, b.model);
  if (!model || !model.voices.some((v) => v.id === b.voice))
    return Response.json({ error: "Unknown voice" }, { status: 400 });
  const spec = effectiveSpec(
    {
      provider: b.provider,
      model: b.model,
      voice: b.voice,
      text: (b.text || SAMPLE).slice(0, 200),
      emotion: b.emotion && isEmotion(b.emotion) ? b.emotion : "neutral",
      speed: Math.min(1.6, Math.max(0.6, Number(b.speed) || 1)),
    },
    model.emotion,
  );
  const key = cacheKey(spec);
  const db = getDb();
  let [clip] = await db.select().from(s.clips).where(eq(s.clips.cache_key, key));
  let cost = 0;
  if (!clip) {
    try {
      const out = await synthesizeLine(spec);
      const id = crypto.randomUUID();
      const audioKey = `clips/${id}.mp3`;
      await putObject(audioKey, await encodeMp3(out.pcm));
      cost = out.costUsd;
      [clip] = await db
        .insert(s.clips)
        .values({ id, cache_key: key, ...spec, audio_key: audioKey, duration_ms: durationMs(out.pcm), cost_usd: cost, provider_generation_id: out.providerGenerationId })
        .onConflictDoNothing({ target: s.clips.cache_key })
        .returning();
      clip ??= (await db.select().from(s.clips).where(eq(s.clips.cache_key, key)))[0];
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 502 });
    }
  }
  return Response.json({ url: await signedUrl(clip.audio_key), cost_usd: cost, cached: cost === 0 && clip.cost_usd > 0 });
}
