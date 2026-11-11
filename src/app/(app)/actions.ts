"use server";

import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getUser } from "@/lib/auth/server";
import {
  createCharacter,
  createConversation,
  deleteCharacter,
  deleteConversation,
  markTutorialDone,
  updateCharacter,
} from "@/lib/data";
import { getDb, schema as s } from "@/lib/db";
import { findModel } from "@/lib/tts/catalog";

async function user() {
  const u = await getUser();
  if (!u) redirect("/auth/sign-in");
  return u;
}

export async function newConversation(template: boolean) {
  const u = await user();
  const id = await createConversation(u.id, { template });
  redirect(`/conversations/${id}`);
}

export async function removeConversation(id: string) {
  const u = await user();
  await deleteConversation(u.id, id);
  revalidatePath("/");
}

const characterInput = z.object({
  name: z.string().trim().min(1).max(60),
  gender: z.string().max(20),
  age_group: z.string().max(20),
  accent: z.string().max(40),
  provider: z.enum(["supertonic", "openrouter"]),
  model: z.string().min(1).max(120),
  voice: z.string().min(1).max(200),
  default_speed: z.number().min(0.6).max(1.6),
});

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

export async function saveCharacter(id: string | null, raw: z.input<typeof characterInput>): Promise<SaveResult> {
  const u = await user();
  const parsed = characterInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please fill in every field." };
  const model = await findModel(parsed.data.provider, parsed.data.model);
  if (!model?.voices.some((v) => v.id === parsed.data.voice)) return { ok: false, error: "That voice isn't available." };
  if (id) await updateCharacter(u.id, id, parsed.data);
  else id = await createCharacter(u.id, parsed.data);
  revalidatePath("/characters");
  return { ok: true, id };
}

export async function removeCharacter(id: string) {
  const u = await user();
  await deleteCharacter(u.id, id);
  revalidatePath("/characters");
}

export async function setTutorialDone(done: boolean) {
  const u = await user();
  await markTutorialDone(u.id, done);
}

/** Create (or reuse) a public link for one generated version. */
export async function createShare(generationId: string, hideTranscript: boolean): Promise<string> {
  const u = await user();
  const db = getDb();
  const [g] = await db
    .select({ id: s.generations.id })
    .from(s.generations)
    .where(and(eq(s.generations.id, generationId), eq(s.generations.user_id, u.id), eq(s.generations.status, "done")));
  if (!g) throw new Error("Only finished audio can be shared.");
  const token = randomBytes(12).toString("base64url");
  await db.insert(s.shares).values({ token, user_id: u.id, generation_id: generationId, hide_transcript: hideTranscript });
  return token;
}

export async function revokeShare(token: string) {
  const u = await user();
  await getDb()
    .update(s.shares)
    .set({ revoked_at: new Date() })
    .where(and(eq(s.shares.token, token), eq(s.shares.user_id, u.id)));
}
