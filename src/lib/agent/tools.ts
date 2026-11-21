import "server-only";

import { randomBytes } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  createCharacter,
  createConversation,
  deleteCharacter,
  deleteConversation,
  ensureSeeded,
  getConversation,
  getDraftLines,
  listCharacters,
  listConversations,
  syncDraft,
  updateCharacter,
  type CharacterView,
  type DraftLine,
} from "../data";
import { getDb, schema as s } from "../db";
import { EMOTIONS, isEmotion, SPEED_MAX, SPEED_MIN, type Emotion } from "../emotions";
import { usdThbRate } from "../env";
import { retryGeneration, startGeneration, triggerWorker, UserError } from "../generation";
import { conversationHistory, type HistoryEntry } from "../history";
import { encodeMp3, durationMs } from "../audio";
import { putObject, signedUrl } from "../storage";
import { findModel, listModels, type ModelOption } from "../tts/catalog";
import { budget } from "../tts/openrouter";
import { cacheKey, effectiveSpec, synthesizeLine } from "../tts";
import { agentFromRequest, listAgentKeys, requestLoginCode, revokeAgentKey, verifyLoginCode, type AgentUser } from "./keys";
import { resolveGaps, signedPdfUrl, versionLines } from "./pdf";

export class ToolError extends Error {}

export type ToolContext = { user: AgentUser | null; origin: string; req: Request };

type Tool<S extends z.ZodType> = {
  name: string;
  description: string;
  input: S;
  /** false for the two sign-in tools; every other tool needs an access key. */
  auth?: boolean;
  run(ctx: ToolContext & { user: AgentUser }, input: z.infer<S>): Promise<unknown>;
};

const tool = <S extends z.ZodType>(t: Tool<S>) => t as unknown as Tool<z.ZodType>;

const URL_TTL = 24 * 3600; // audio/PDF links stay valid for a day
const id = z.uuid();
const emotion = z.enum(EMOTIONS.map((e) => e.id) as [Emotion, ...Emotion[]]);
const speed = z.number().min(SPEED_MIN).max(SPEED_MAX);
const thb = (usd: number) => Math.round(usd * usdThbRate() * 100) / 100;
const abs = (origin: string, u: string | null) => (u ? (u.startsWith("/") ? origin + u : u) : null);

// ------------------------------------------------------------------ helpers

async function voiceInfo(provider: string, model: string, voice: string) {
  const m = await findModel(provider, model);
  const v = m?.voices.find((x) => x.id === voice);
  return { m, v };
}

async function describeCharacter(c: CharacterView) {
  const { m, v } = await voiceInfo(c.provider, c.model, c.voice);
  return {
    character_id: c.id,
    version: c.version,
    name: c.name,
    gender: c.gender,
    age_group: c.age_group,
    accent: c.accent,
    default_speed: c.default_speed,
    voice: { provider: c.provider, model: c.model, voice: c.voice, label: v?.label ?? c.voice, service: m?.name ?? c.model },
    sounds_like_child: v?.age === "child" || v?.age === "teen",
    supports_emotions: m ? m.emotion !== "none" : false,
    voice_available: !!(m && v),
    cost_per_16_line_conversation_thb: m ? thb(m.est_template_usd) : null,
  };
}

/** Accepts a character id or (case-insensitive) name. */
async function resolveCharacter(userId: string, ref: string): Promise<CharacterView> {
  const chars = await listCharacters(userId);
  const c = chars.find((x) => x.id === ref) ?? chars.find((x) => x.name.toLowerCase() === ref.trim().toLowerCase());
  if (!c) throw new ToolError(`No character "${ref}". Call list_characters to see the teacher's characters.`);
  return c;
}

async function requireConversation(userId: string, conversationId: string) {
  const meta = await getConversation(userId, conversationId);
  if (!meta) throw new ToolError("Conversation not found. Call list_conversations.");
  return meta;
}

async function conversationView(userId: string, conversationId: string) {
  const meta = await requireConversation(userId, conversationId);
  const chars = new Map((await listCharacters(userId, true)).map((c) => [c.id, c]));
  const lines = (await getDraftLines(userId, conversationId)).filter((l) => !l.deleted);
  return {
    conversation_id: meta.id,
    title: meta.title,
    pause_between_lines_seconds: meta.pause_ms / 1000,
    lines: await Promise.all(
      lines.map(async (l, i) => {
        const c = l.character_id ? chars.get(l.character_id) : undefined;
        const m = c ? await findModel(c.provider, c.model) : undefined;
        return {
          line_number: i + 1,
          line_id: l.id,
          character_id: l.character_id,
          character_name: c?.name ?? null,
          text: l.text,
          emotion: l.emotion,
          emotion_will_be_used: !!m && m.emotion !== "none",
          speed: l.speed ?? c?.default_speed ?? 1,
          speed_is_character_default: l.speed == null,
        };
      }),
    ),
  };
}

/** Writes lines exactly like the website does, so open browser tabs update live. */
async function writeLines(userId: string, conversationId: string, lines: DraftLine[]) {
  await syncDraft(userId, conversationId, null, lines);
}

async function lineSpec(userId: string, input: { character: string; text: string; emotion?: Emotion; speed?: number | null }) {
  const c = await resolveCharacter(userId, input.character);
  if (!input.text.trim()) throw new ToolError("Line text can't be empty.");
  return { character_id: c.id, text: input.text.trim(), emotion: input.emotion ?? "neutral", speed: input.speed ?? null };
}

function entryView(origin: string, e: HistoryEntry) {
  return {
    generation_id: e.id,
    version: e.version,
    title: e.title,
    status: e.status,
    progress: `${e.done_items}/${e.total_items} lines`,
    error: e.error,
    created_at: e.created_at,
    duration_seconds: e.duration_ms != null ? Math.round(e.duration_ms / 100) / 10 : null,
    cost_usd: e.cost_usd,
    cost_thb: thb(e.cost_usd),
    audio_mp3_url: abs(origin, e.download_url),
    links_expire_in_hours: 24,
    pause_between_lines_seconds: e.pause_ms / 1000,
    lines: e.lines.map((l, i) => ({
      line_number: i + 1,
      character: l.character,
      text: l.text,
      emotion: l.emotion,
      speed: l.speed,
      starts_at_seconds: l.start_ms != null ? l.start_ms / 1000 : null,
      ends_at_seconds: l.end_ms != null ? l.end_ms / 1000 : null,
      line_mp3_url: abs(origin, l.clip_url),
    })),
    voices_used: e.characters.map((c) => ({
      character: c.name,
      character_version: c.version,
      voice: c.voice,
      changed_since: c.deleted ? "character was removed" : c.changes.map((x) => `${x.field}: ${x.then} → ${x.now}`),
    })),
    share_links: e.shares.map((x) => ({ url: `${origin}/s/${x.token}`, token: x.token, hide_transcript: x.hide_transcript })),
  };
}

async function generationEntry(ctx: ToolContext & { user: AgentUser }, generationId: string) {
  const [g] = await getDb()
    .select({ conversation_id: s.generations.conversation_id })
    .from(s.generations)
    .where(and(eq(s.generations.id, generationId), eq(s.generations.user_id, ctx.user.id)));
  if (!g) throw new ToolError("Generation not found. Use list_versions to find generation ids.");
  const e = (await conversationHistory(ctx.user.id, g.conversation_id, URL_TTL)).find((x) => x.id === generationId)!;
  return entryView(ctx.origin, e);
}

function modelView(m: ModelOption, includeVoices: boolean) {
  return {
    provider: m.provider,
    model: m.model,
    name: m.name,
    free: m.free,
    has_child_voices: m.child_voices,
    supports_emotions: m.emotion !== "none",
    cost_per_16_line_conversation_usd: m.est_template_usd,
    cost_per_16_line_conversation_thb: thb(m.est_template_usd),
    price: m.price_note,
    notes: m.notes,
    voice_count: m.voices.length,
    voices: includeVoices ? m.voices.map((v) => ({ voice: v.id, label: v.label, gender: v.gender, accent: v.accent, age: v.age ?? "adult" })) : undefined,
  };
}

// ------------------------------------------------------------------ tools

const characterFields = {
  gender: z.enum(["female", "male", "neutral"]).optional().describe("Defaults to what the voice is known to be."),
  age_group: z.enum(["child", "teen", "young_adult", "adult", "senior"]).optional().describe("A label only; the voice decides how it sounds."),
  accent: z.string().max(40).optional(),
  default_speed: speed.optional().describe("0.6–1.6, default 1."),
};

export const TOOLS = [
  tool({
    name: "request_login_code",
    auth: false,
    description:
      "Step 1 of connecting. Emails the teacher a one-time sign-in code. Ask the teacher for their email, call this, then ask them for the code from the email (or read it yourself if you can access their inbox).",
    input: z.object({ email: z.string().describe("The teacher's email address.") }),
    async run(ctx, i) {
      const r = await requestLoginCode(ctx.origin, i.email);
      return { sent_to: r.email, next: "Ask the teacher for the code in the email from the app, then call verify_login_code. The code expires after a few minutes." };
    },
  }),
  tool({
    name: "verify_login_code",
    auth: false,
    description:
      "Step 2 of connecting. Exchanges the emailed code for an access key. Store the key securely and send it as 'Authorization: Bearer <key>' on every later call. It works until the teacher revokes it on the website's AI agents page.",
    input: z.object({
      email: z.string(),
      code: z.string().describe("The code from the email."),
      agent_name: z.string().max(80).optional().describe("How this agent appears in the teacher's list, e.g. 'WhatsApp assistant'."),
    }),
    async run(ctx, i) {
      const r = await verifyLoginCode(ctx.origin, i.email, i.code, i.agent_name);
      return { ...r, how_to_use: "Send header 'Authorization: Bearer <api_key>' with every request." };
    },
  }),
  tool({
    name: "get_account",
    description: "The signed-in teacher, the shared budget left for paid voices (USD and Thai baht), and counts.",
    input: z.object({}),
    async run(ctx) {
      const [b, convs, chars] = await Promise.all([budget().catch(() => null), listConversations(ctx.user.id), listCharacters(ctx.user.id)]);
      return {
        email: ctx.user.email,
        website: ctx.origin,
        usd_thb_rate: usdThbRate(),
        shared_budget: b?.remaining != null ? { remaining_usd: b.remaining, remaining_thb: thb(b.remaining), note: "Shared by all teachers. Free voices never use it." } : null,
        conversations: convs.length,
        characters: chars.length,
      };
    },
  }),
  tool({
    name: "list_voice_services",
    description:
      "Voice services and voices a character can use, with prices, child/adult voices, emotion support and plain-language notes. Free voices are adults only; child voices cost a little.",
    input: z.object({ include_voices: z.boolean().optional().describe("Default true.") }),
    async run(_ctx, i) {
      return { services: (await listModels()).map((m) => modelView(m, i.include_voices !== false)) };
    },
  }),
  tool({
    name: "preview_voice",
    description: "Speaks a short sample with a voice and returns an MP3 link. Paid voices cost a fraction of a baht, once per voice and text.",
    input: z.object({ provider: z.string(), model: z.string(), voice: z.string(), speed: speed.optional(), text: z.string().max(200).optional() }),
    async run(ctx, i) {
      const m = await findModel(i.provider, i.model);
      if (!m?.voices.some((v) => v.id === i.voice)) throw new ToolError("Unknown voice. Use list_voice_services.");
      const spec = effectiveSpec(
        { provider: i.provider, model: i.model, voice: i.voice, text: i.text || "Hi there! This is how I sound when I read your conversation.", emotion: "neutral", speed: i.speed ?? 1 },
        m.emotion,
      );
      const key = cacheKey(spec);
      const db = getDb();
      let [clip] = await db.select().from(s.clips).where(eq(s.clips.cache_key, key));
      let cost = 0;
      if (!clip) {
        const out = await synthesizeLine(spec);
        const cid = crypto.randomUUID();
        const audioKey = `clips/${cid}.mp3`;
        await putObject(audioKey, await encodeMp3(out.pcm));
        cost = out.costUsd;
        [clip] = await db
          .insert(s.clips)
          .values({ id: cid, cache_key: key, ...spec, audio_key: audioKey, duration_ms: durationMs(out.pcm), cost_usd: cost, provider_generation_id: out.providerGenerationId })
          .onConflictDoNothing({ target: s.clips.cache_key })
          .returning();
        clip ??= (await db.select().from(s.clips).where(eq(s.clips.cache_key, key)))[0];
      }
      return { mp3_url: abs(ctx.origin, await signedUrl(clip.audio_key, "voice-preview.mp3", URL_TTL)), cost_usd: cost, cost_thb: thb(cost) };
    },
  }),

  // characters
  tool({
    name: "list_characters",
    description: "The teacher's characters (speakers) with their voices, whether they sound like a child, and whether they can use emotions.",
    input: z.object({}),
    async run(ctx) {
      return { characters: await Promise.all((await listCharacters(ctx.user.id)).map(describeCharacter)) };
    },
  }),
  tool({
    name: "create_character",
    description: "Creates a character. Pick provider/model/voice from list_voice_services.",
    input: z.object({ name: z.string().min(1).max(60), provider: z.string(), model: z.string(), voice: z.string(), ...characterFields }),
    async run(ctx, i) {
      const { m, v } = await voiceInfo(i.provider, i.model, i.voice);
      if (!m || !v) throw new ToolError("Unknown voice. Use list_voice_services.");
      const cid = await createCharacter(ctx.user.id, {
        name: i.name.trim(),
        provider: i.provider,
        model: i.model,
        voice: i.voice,
        gender: i.gender ?? (v.gender === "male" || v.gender === "female" ? v.gender : "neutral"),
        age_group: i.age_group ?? v.age ?? "adult",
        accent: i.accent ?? (v.accent !== "Not specified" ? v.accent : "Not specified"),
        default_speed: i.default_speed ?? 1,
      });
      return describeCharacter((await listCharacters(ctx.user.id)).find((c) => c.id === cid)!);
    },
  }),
  tool({
    name: "update_character",
    description:
      "Changes a character (name, voice, labels, default speed). Creates a new character version; audio made earlier keeps a record of the old voice.",
    input: z.object({
      character: z.string().describe("Character id or name."),
      name: z.string().min(1).max(60).optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      voice: z.string().optional(),
      ...characterFields,
    }),
    async run(ctx, i) {
      const c = await resolveCharacter(ctx.user.id, i.character);
      const next = {
        name: i.name?.trim() ?? c.name,
        provider: i.provider ?? c.provider,
        model: i.model ?? c.model,
        voice: i.voice ?? c.voice,
        gender: i.gender ?? c.gender,
        age_group: i.age_group ?? c.age_group,
        accent: i.accent ?? c.accent,
        default_speed: i.default_speed ?? c.default_speed,
      };
      const { m, v } = await voiceInfo(next.provider, next.model, next.voice);
      if (!m || !v) throw new ToolError("Unknown voice. Use list_voice_services.");
      if (i.voice && !i.age_group && v.age) next.age_group = v.age;
      await updateCharacter(ctx.user.id, c.id, next);
      return describeCharacter((await listCharacters(ctx.user.id)).find((x) => x.id === c.id)!);
    },
  }),
  tool({
    name: "delete_character",
    description: "Removes a character. Audio already made with it keeps working.",
    input: z.object({ character: z.string().describe("Character id or name.") }),
    async run(ctx, i) {
      const c = await resolveCharacter(ctx.user.id, i.character);
      await deleteCharacter(ctx.user.id, c.id);
      return { deleted: c.name };
    },
  }),

  // conversations
  tool({
    name: "list_conversations",
    description: "The teacher's conversations with line and version counts.",
    input: z.object({}),
    async run(ctx) {
      return {
        conversations: (await listConversations(ctx.user.id)).map((c) => ({
          conversation_id: c.id,
          title: c.title,
          lines: c.lines,
          versions: c.versions,
          created_at: c.created_at,
          web_url: `${ctx.origin}/conversations/${c.id}`,
        })),
      };
    },
  }),
  tool({
    name: "create_conversation",
    description:
      "Creates a conversation: empty, from the 16-line 'Family dinner' template, or with the lines you pass. Lines reference characters by id or name.",
    input: z.object({
      title: z.string().max(200).optional(),
      from_template: z.boolean().optional(),
      pause_between_lines_seconds: z.number().min(0).max(5).optional(),
      lines: z
        .array(z.object({ character: z.string(), text: z.string().max(2000), emotion: emotion.optional(), speed: speed.nullable().optional() }))
        .max(300)
        .optional(),
    }),
    async run(ctx, i) {
      const cid = await createConversation(ctx.user.id, { template: !!i.from_template });
      const now = Date.now();
      if (i.title || i.pause_between_lines_seconds != null) {
        const meta = (await getConversation(ctx.user.id, cid))!;
        await syncDraft(
          ctx.user.id,
          cid,
          { title: i.title ?? meta.title, pause_ms: i.pause_between_lines_seconds != null ? i.pause_between_lines_seconds * 1000 : meta.pause_ms, updated_ms: now },
          [],
        );
      }
      if (i.lines?.length) {
        const old = await getDraftLines(ctx.user.id, cid);
        const fresh: DraftLine[] = [];
        for (const [n, l] of i.lines.entries()) fresh.push({ id: crypto.randomUUID(), position: n + 1, deleted: false, updated_ms: now + 1, ...(await lineSpec(ctx.user.id, l)) });
        await writeLines(ctx.user.id, cid, [...old.map((o) => ({ ...o, deleted: true, updated_ms: now + 1 })), ...fresh]);
      }
      return conversationView(ctx.user.id, cid);
    },
  }),
  tool({
    name: "get_conversation",
    description: "A conversation's current (editable) lines, with line ids, speakers, emotions and speeds.",
    input: z.object({ conversation_id: id }),
    async run(ctx, i) {
      return conversationView(ctx.user.id, i.conversation_id);
    },
  }),
  tool({
    name: "update_conversation",
    description: "Renames a conversation or changes the pause between lines.",
    input: z.object({ conversation_id: id, title: z.string().max(200).optional(), pause_between_lines_seconds: z.number().min(0).max(5).optional() }),
    async run(ctx, i) {
      const meta = await requireConversation(ctx.user.id, i.conversation_id);
      await syncDraft(
        ctx.user.id,
        i.conversation_id,
        {
          title: i.title ?? meta.title,
          pause_ms: i.pause_between_lines_seconds != null ? Math.round(i.pause_between_lines_seconds * 1000) : meta.pause_ms,
          updated_ms: Math.max(Date.now(), meta.updated_ms + 1),
        },
        [],
      );
      return conversationView(ctx.user.id, i.conversation_id);
    },
  }),
  tool({
    name: "delete_conversation",
    description: "Deletes a conversation and its history.",
    input: z.object({ conversation_id: id }),
    async run(ctx, i) {
      await requireConversation(ctx.user.id, i.conversation_id);
      await deleteConversation(ctx.user.id, i.conversation_id);
      return { deleted: i.conversation_id };
    },
  }),
  tool({
    name: "set_lines",
    description: "Replaces all lines of a conversation with the ones given, in order.",
    input: z.object({
      conversation_id: id,
      lines: z.array(z.object({ character: z.string(), text: z.string().max(2000), emotion: emotion.optional(), speed: speed.nullable().optional() })).max(300),
    }),
    async run(ctx, i) {
      await requireConversation(ctx.user.id, i.conversation_id);
      const now = Date.now();
      const old = (await getDraftLines(ctx.user.id, i.conversation_id)).filter((l) => !l.deleted);
      const fresh: DraftLine[] = [];
      for (const [n, l] of i.lines.entries()) fresh.push({ id: crypto.randomUUID(), position: n + 1, deleted: false, updated_ms: now, ...(await lineSpec(ctx.user.id, l)) });
      await writeLines(ctx.user.id, i.conversation_id, [...old.map((o) => ({ ...o, deleted: true, updated_ms: Math.max(now, o.updated_ms + 1) })), ...fresh]);
      return conversationView(ctx.user.id, i.conversation_id);
    },
  }),
  tool({
    name: "add_line",
    description: "Adds one line, at the end or after a given line.",
    input: z.object({
      conversation_id: id,
      character: z.string().describe("Character id or name."),
      text: z.string().max(2000),
      emotion: emotion.optional(),
      speed: speed.nullable().optional().describe("Omit or null to use the character's default."),
      after_line_id: id.optional(),
    }),
    async run(ctx, i) {
      await requireConversation(ctx.user.id, i.conversation_id);
      const list = (await getDraftLines(ctx.user.id, i.conversation_id)).filter((l) => !l.deleted).sort((a, b) => a.position - b.position);
      const at = i.after_line_id ? list.findIndex((l) => l.id === i.after_line_id) : list.length - 1;
      if (i.after_line_id && at < 0) throw new ToolError("after_line_id is not a line of this conversation.");
      const before = list[at]?.position ?? 0;
      const after = list[at + 1]?.position ?? before + 2;
      await writeLines(ctx.user.id, i.conversation_id, [
        { id: crypto.randomUUID(), position: (before + after) / 2, deleted: false, updated_ms: Date.now(), ...(await lineSpec(ctx.user.id, i)) },
      ]);
      return conversationView(ctx.user.id, i.conversation_id);
    },
  }),
  tool({
    name: "update_line",
    description: "Changes one line's speaker, text, emotion or speed.",
    input: z.object({
      conversation_id: id,
      line_id: id,
      character: z.string().optional(),
      text: z.string().max(2000).optional(),
      emotion: emotion.optional(),
      speed: speed.nullable().optional().describe("null = the character's default speed."),
    }),
    async run(ctx, i) {
      const l = (await getDraftLines(ctx.user.id, i.conversation_id)).find((x) => x.id === i.line_id && !x.deleted);
      if (!l) throw new ToolError("Line not found. Use get_conversation for line ids.");
      const next = { ...l, updated_ms: Math.max(Date.now(), l.updated_ms + 1) };
      if (i.character) next.character_id = (await resolveCharacter(ctx.user.id, i.character)).id;
      if (i.text !== undefined) next.text = i.text;
      if (i.emotion) next.emotion = i.emotion;
      if (i.speed !== undefined) next.speed = i.speed;
      await writeLines(ctx.user.id, i.conversation_id, [next]);
      return conversationView(ctx.user.id, i.conversation_id);
    },
  }),
  tool({
    name: "delete_line",
    description: "Removes one line.",
    input: z.object({ conversation_id: id, line_id: id }),
    async run(ctx, i) {
      const l = (await getDraftLines(ctx.user.id, i.conversation_id)).find((x) => x.id === i.line_id && !x.deleted);
      if (!l) throw new ToolError("Line not found.");
      await writeLines(ctx.user.id, i.conversation_id, [{ ...l, deleted: true, updated_ms: Math.max(Date.now(), l.updated_ms + 1) }]);
      return conversationView(ctx.user.id, i.conversation_id);
    },
  }),
  tool({
    name: "move_line",
    description: "Moves a line one place up or down.",
    input: z.object({ conversation_id: id, line_id: id, direction: z.enum(["up", "down"]) }),
    async run(ctx, i) {
      const list = (await getDraftLines(ctx.user.id, i.conversation_id)).filter((l) => !l.deleted).sort((a, b) => a.position - b.position);
      const k = list.findIndex((l) => l.id === i.line_id);
      const j = k + (i.direction === "up" ? -1 : 1);
      if (k < 0) throw new ToolError("Line not found.");
      if (j >= 0 && j < list.length) {
        const now = Date.now();
        await writeLines(ctx.user.id, i.conversation_id, [
          { ...list[k], position: list[j].position, updated_ms: Math.max(now, list[k].updated_ms + 1) },
          { ...list[j], position: list[k].position, updated_ms: Math.max(now, list[j].updated_ms + 1) },
        ]);
      }
      return conversationView(ctx.user.id, i.conversation_id);
    },
  }),

  // audio
  tool({
    name: "estimate_cost",
    description:
      "Estimated cost of converting the conversation now, per line and in total (USD and baht). Lines already made with the same voice, text, emotion and speed are reused for free.",
    input: z.object({ conversation_id: id }),
    async run(ctx, i) {
      const view = await conversationView(ctx.user.id, i.conversation_id);
      const chars = new Map((await listCharacters(ctx.user.id, true)).map((c) => [c.id, c]));
      const rows = await Promise.all(
        view.lines.map(async (l) => {
          const c = l.character_id ? chars.get(l.character_id) : undefined;
          const m = c ? await findModel(c.provider, c.model) : undefined;
          if (!c || !m) return { line_number: l.line_number, problem: c ? "voice no longer available" : "no speaker", key: null, usd: 0 };
          const spec = effectiveSpec({ provider: c.provider, model: c.model, voice: c.voice, text: l.text, emotion: isEmotion(l.emotion) ? l.emotion : "neutral", speed: l.speed }, m.emotion);
          return { line_number: l.line_number, problem: null, key: cacheKey(spec), usd: (m.est_template_usd / 995) * l.text.length };
        }),
      );
      const keys = rows.map((r) => r.key).filter((k): k is string => !!k);
      const cached = new Set(keys.length ? (await getDb().select({ k: s.clips.cache_key }).from(s.clips).where(inArray(s.clips.cache_key, keys))).map((r) => r.k) : []);
      const lines = rows.map((r) => ({ line_number: r.line_number, problem: r.problem, reused_free: !!r.key && cached.has(r.key), estimated_usd: r.key && cached.has(r.key) ? 0 : r.usd }));
      const total = lines.reduce((n, l) => n + l.estimated_usd, 0);
      return { total_usd: total, total_thb: thb(total), lines: lines.map((l) => ({ ...l, estimated_thb: thb(l.estimated_usd) })), note: "Estimate; the actual cost is reported on the version after conversion." };
    },
  }),
  tool({
    name: "convert_to_audio",
    description:
      "Snapshots the conversation as a new version (v1, v2…) and starts making the audio. Takes about 1–3 minutes; poll get_version every 10–15 seconds until status is 'done', then send the teacher audio_mp3_url. Paid voices use the shared budget (see estimate_cost).",
    input: z.object({ conversation_id: id }),
    async run(ctx, i) {
      try {
        const r = await startGeneration(ctx.user.id, i.conversation_id);
        await triggerWorker(ctx.origin, r.generationId);
        return { generation_id: r.generationId, version: r.version, status: "queued", next: "Poll get_version with this generation_id." };
      } catch (e) {
        if (e instanceof UserError) throw new ToolError(e.message);
        throw e;
      }
    },
  }),
  tool({
    name: "list_versions",
    description: "All converted versions of a conversation (newest first) with status, cost, MP3 links and what changed in characters since.",
    input: z.object({ conversation_id: id }),
    async run(ctx, i) {
      await requireConversation(ctx.user.id, i.conversation_id);
      return { versions: (await conversationHistory(ctx.user.id, i.conversation_id, URL_TTL)).map((e) => entryView(ctx.origin, e)) };
    },
  }),
  tool({
    name: "get_version",
    description: "One converted version: status/progress while generating; when done, MP3 links for the whole conversation and each line, timings and cost.",
    input: z.object({ generation_id: id }),
    async run(ctx, i) {
      const e = await generationEntry(ctx, i.generation_id);
      if (e.status === "queued" || e.status === "running") await triggerWorker(ctx.origin, i.generation_id); // resumes stalled work
      return e;
    },
  }),
  tool({
    name: "retry_version",
    description: "Retries the failed lines of a failed version.",
    input: z.object({ generation_id: id }),
    async run(ctx, i) {
      if (!(await retryGeneration(ctx.user.id, i.generation_id))) throw new ToolError("Only failed versions can be retried.");
      await triggerWorker(ctx.origin, i.generation_id);
      return generationEntry(ctx, i.generation_id);
    },
  }),
  tool({
    name: "restore_version",
    description: "Loads an older version's lines back into the editable conversation (to edit and convert again).",
    input: z.object({ generation_id: id }),
    async run(ctx, i) {
      const [g] = await getDb()
        .select({ conversation_id: s.generations.conversation_id, lines: s.conversation_versions.lines })
        .from(s.generations)
        .innerJoin(s.conversation_versions, eq(s.conversation_versions.id, s.generations.version_id))
        .where(and(eq(s.generations.id, i.generation_id), eq(s.generations.user_id, ctx.user.id)));
      if (!g) throw new ToolError("Version not found.");
      const now = Date.now();
      const current = (await getDraftLines(ctx.user.id, g.conversation_id)).filter((l) => !l.deleted);
      const keep = new Set(g.lines.map((l) => l.id));
      await writeLines(ctx.user.id, g.conversation_id, [
        ...current.filter((l) => !keep.has(l.id)).map((l) => ({ ...l, deleted: true, updated_ms: Math.max(now, l.updated_ms + 1) })),
        ...g.lines.map((l, n) => ({ id: l.id, position: n + 1, character_id: l.character_id, text: l.text, emotion: l.emotion, speed: l.speed, deleted: false, updated_ms: now + 1 })),
      ]);
      return conversationView(ctx.user.id, g.conversation_id);
    },
  }),

  // sharing and files
  tool({
    name: "create_share_link",
    description: "A public link where students can listen to a finished version without signing in. Optionally hide the transcript (for listening tests).",
    input: z.object({ generation_id: id, hide_transcript: z.boolean().optional() }),
    async run(ctx, i) {
      const [g] = await getDb()
        .select({ id: s.generations.id })
        .from(s.generations)
        .where(and(eq(s.generations.id, i.generation_id), eq(s.generations.user_id, ctx.user.id), eq(s.generations.status, "done")));
      if (!g) throw new ToolError("Only a finished version can be shared.");
      const token = randomBytes(12).toString("base64url");
      await getDb().insert(s.shares).values({ token, user_id: ctx.user.id, generation_id: g.id, hide_transcript: !!i.hide_transcript });
      return { url: `${ctx.origin}/s/${token}`, token, hide_transcript: !!i.hide_transcript };
    },
  }),
  tool({
    name: "revoke_share_link",
    description: "Turns off a share link immediately.",
    input: z.object({ token: z.string().describe("The token, or the whole share URL.") }),
    async run(ctx, i) {
      const token = i.token.split("/s/").pop()!.trim();
      const rows = await getDb()
        .update(s.shares)
        .set({ revoked_at: new Date() })
        .where(and(eq(s.shares.token, token), eq(s.shares.user_id, ctx.user.id), isNull(s.shares.revoked_at)))
        .returning({ id: s.shares.id });
      if (!rows.length) throw new ToolError("No active share link with that token.");
      return { revoked: token };
    },
  }),
  tool({
    name: "get_pdf",
    description:
      "Download link for a version's PDF: 'script' (the text, with speaker names unless one person speaks) or 'worksheet' (gap-fill with answer key). Worksheet gaps are chosen automatically unless you pass words to blank.",
    input: z.object({
      generation_id: id,
      kind: z.enum(["script", "worksheet"]),
      gaps: z.array(z.object({ line: z.number().int().min(1), word: z.string() })).max(200).optional().describe("Worksheet only: words to blank, by 1-based line number."),
    }),
    async run(ctx, i) {
      const [g] = await getDb().select({ id: s.generations.id }).from(s.generations).where(and(eq(s.generations.id, i.generation_id), eq(s.generations.user_id, ctx.user.id)));
      if (!g) throw new ToolError("Version not found.");
      let gaps = "auto";
      let missing: { line: number; word: string }[] = [];
      if (i.kind === "worksheet" && i.gaps?.length) {
        const v = (await versionLines(g.id))!;
        const r = resolveGaps(v.lines, i.gaps);
        gaps = r.encoded;
        missing = r.missing;
      }
      return { pdf_url: signedPdfUrl(ctx.origin, g.id, i.kind, gaps, URL_TTL), link_expires_in_hours: 24, words_not_found: missing };
    },
  }),

  // agents
  tool({
    name: "list_connected_agents",
    description: "Agents connected to this teacher's account (the teacher can revoke them on the website too).",
    input: z.object({}),
    async run(ctx) {
      return { agents: (await listAgentKeys(ctx.user.id)).map((k) => ({ ...k, this_agent: k.id === ctx.user.keyId })) };
    },
  }),
  tool({
    name: "disconnect",
    description: "Revokes this agent's own access key. The agent must sign in again (request_login_code) to reconnect.",
    input: z.object({}),
    async run(ctx) {
      await revokeAgentKey(ctx.user.id, ctx.user.keyId);
      return { disconnected: true };
    },
  }),
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

export function toolSchemas() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    requires_access_key: t.auth !== false,
    inputSchema: z.toJSONSchema(t.input, { io: "input" }),
  }));
}

/** Runs a tool for a request. Returns { ok, result } or { ok: false, error, status }. */
export async function runTool(req: Request, name: string, args: unknown) {
  const t = toolByName.get(name);
  if (!t) return { ok: false as const, status: 404, error: `Unknown tool "${name}". See the tool list.` };
  const origin = new URL(req.url).origin;
  const user = t.auth === false ? null : await agentFromRequest(req);
  if (t.auth !== false && !user)
    return { ok: false as const, status: 401, error: "Missing or revoked access key. Connect with request_login_code and verify_login_code, then send 'Authorization: Bearer <key>'." };
  if (user) await ensureSeeded(user.id); // starter characters + template, once
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: `Invalid input: ${z.prettifyError(parsed.error)}` };
  try {
    return { ok: true as const, result: await t.run({ user: user!, origin, req }, parsed.data) };
  } catch (e) {
    if (e instanceof ToolError) return { ok: false as const, status: 400, error: e.message };
    const ae = e as { status?: number; code?: string; message?: string };
    if (ae?.code && ae?.status) return { ok: false as const, status: ae.status, error: ae.message ?? "Error" };
    console.error("[agent tool]", name, e);
    return { ok: false as const, status: 500, error: "Something went wrong on the server. Try again." };
  }
}
