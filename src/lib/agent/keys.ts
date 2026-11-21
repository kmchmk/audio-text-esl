import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import { ensureSeeded } from "../data";
import { getDb, schema as s } from "../db";
import { env, isEmailAllowed } from "../env";

const KEY_PREFIX = "esl_";
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export type AgentUser = { id: string; email: string; name: string; keyId: string };

export class AgentAuthError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "BAD_REQUEST",
  ) {
    super(message);
  }
}

const normEmail = (e: string) => String(e ?? "").trim().toLowerCase();

/**
 * Calls Neon Auth's HTTP API directly. Agents call us from their own servers without a browser
 * Origin header, so we send the app's own (trusted) origin, and no cookies are set.
 */
async function neonAuth<T>(origin: string, path: string, body: unknown): Promise<{ data: T | null; error: { message?: string; code?: string } | null }> {
  const res = await fetch(`${env().authBaseUrl.replace(/\/$/, "")}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as (T & { message?: string; code?: string }) | null;
  if (!res.ok) return { data: null, error: { message: json?.message, code: json?.code } };
  return { data: json, error: null };
}

/** Step 1: email the teacher a one-time sign-in code (sent by Neon Auth). */
export async function requestLoginCode(origin: string, rawEmail: string) {
  const email = normEmail(rawEmail);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AgentAuthError("That doesn't look like an email address.", 400, "INVALID_EMAIL");
  if (!isEmailAllowed(email))
    throw new AgentAuthError(
      "This email isn't on the list of teachers allowed to use the app. The teacher should ask the app's administrator to add it.",
      403,
      "EMAIL_NOT_ALLOWED",
    );
  const { error } = await neonAuth(origin, "email-otp/send-verification-otp", { email, type: "sign-in" });
  if (error) throw new AgentAuthError(error.message || "Couldn't send the code. Try again in a minute.", 502, "SEND_FAILED");
  return { email };
}

/**
 * Step 2: exchange the code for a permanent access key (valid until the teacher revokes it).
 * Signing in with a code also creates the teacher's account on first use.
 */
export async function verifyLoginCode(origin: string, rawEmail: string, rawCode: string, rawName?: string) {
  const email = normEmail(rawEmail);
  const otp = String(rawCode ?? "").replace(/\s+/g, "");
  if (!isEmailAllowed(email)) throw new AgentAuthError("This email isn't on the allowed list.", 403, "EMAIL_NOT_ALLOWED");
  if (!otp) throw new AgentAuthError("Pass the code from the email.", 400, "MISSING_CODE");
  const { data, error } = await neonAuth<{ user?: { id: string; email: string } }>(origin, "sign-in/email-otp", { email, otp });
  const user = data?.user;
  if (error || !user) {
    const code = error?.code;
    if (code === "TOO_MANY_ATTEMPTS")
      throw new AgentAuthError("Too many wrong codes. Request a new code and try again.", 429, "TOO_MANY_ATTEMPTS");
    throw new AgentAuthError("That code is wrong or has expired. Ask the teacher for the latest code, or request a new one.", 401, "INVALID_CODE");
  }
  await ensureSeeded(user.id);
  const name = (rawName ?? "").trim().slice(0, 80) || "AI agent";
  const key = KEY_PREFIX + randomBytes(24).toString("base64url");
  await getDb().insert(s.agent_keys).values({
    user_id: user.id,
    email,
    name,
    key_hash: hash(key),
    key_prefix: key.slice(0, KEY_PREFIX.length + 6),
  });
  return { api_key: key, email, agent_name: name };
}

/** Resolves a request's `Authorization: Bearer esl_...` header to the teacher, or null. */
export async function agentFromRequest(req: Request): Promise<AgentUser | null> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(esl_[\w-]+)$/i);
  if (!m) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(s.agent_keys)
    .where(and(eq(s.agent_keys.key_hash, hash(m[1])), isNull(s.agent_keys.revoked_at)));
  // Keys stop working as soon as the teacher is removed from ALLOWED_EMAILS.
  if (!row || !isEmailAllowed(row.email)) return null;
  if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > 5 * 60_000)
    await db.update(s.agent_keys).set({ last_used_at: new Date() }).where(eq(s.agent_keys.id, row.id));
  return { id: row.user_id, email: row.email, name: row.email, keyId: row.id };
}

export async function listAgentKeys(userId: string) {
  return getDb()
    .select({
      id: s.agent_keys.id,
      name: s.agent_keys.name,
      key_prefix: s.agent_keys.key_prefix,
      created_at: s.agent_keys.created_at,
      last_used_at: s.agent_keys.last_used_at,
    })
    .from(s.agent_keys)
    .where(and(eq(s.agent_keys.user_id, userId), isNull(s.agent_keys.revoked_at)))
    .orderBy(desc(s.agent_keys.created_at));
}

export async function revokeAgentKey(userId: string, keyId: string) {
  const rows = await getDb()
    .update(s.agent_keys)
    .set({ revoked_at: new Date() })
    .where(and(eq(s.agent_keys.id, keyId), eq(s.agent_keys.user_id, userId), isNull(s.agent_keys.revoked_at)))
    .returning({ id: s.agent_keys.id });
  return rows.length > 0;
}
