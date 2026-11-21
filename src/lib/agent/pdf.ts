import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { getDb, schema as s } from "../db";
import { env } from "../env";
import { blankable, tokenize, type PdfLine } from "../pdf/core";

export type PdfKind = "script" | "worksheet";

const mac = (p: string) => createHmac("sha256", env().workerSecret).update(p).digest("base64url");
const payload = (gen: string, kind: string, gaps: string, exp: number) => `pdf\n${gen}\n${kind}\n${gaps}\n${exp}`;

/** Signed, expiring download link for a version's PDF. `gaps` is "auto" or "line:token,...". */
export function signedPdfUrl(origin: string, generationId: string, kind: PdfKind, gaps = "auto", ttl = 86400) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const q = new URLSearchParams({ g: generationId, k: kind, gaps, e: String(exp), s: mac(payload(generationId, kind, gaps, exp)) });
  return `${origin}/api/pdf?${q}`;
}

export function verifyPdfUrl(q: URLSearchParams) {
  const g = q.get("g") ?? "";
  const k = q.get("k") ?? "";
  const gaps = q.get("gaps") ?? "auto";
  const exp = Number(q.get("e"));
  if (!g || (k !== "script" && k !== "worksheet") || !Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  const a = Buffer.from(q.get("s") ?? "");
  const b = Buffer.from(mac(payload(g, k, gaps, exp)));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { generationId: g, kind: k as PdfKind, gaps };
}

/** Title and lines (with character names) of the version a generation was made from. */
export async function versionLines(generationId: string): Promise<{ title: string; lines: PdfLine[] } | null> {
  const db = getDb();
  const [row] = await db
    .select({ version: s.conversation_versions })
    .from(s.generations)
    .innerJoin(s.conversation_versions, eq(s.conversation_versions.id, s.generations.version_id))
    .where(eq(s.generations.id, generationId));
  if (!row) return null;
  const ids = [...new Set(row.version.lines.map((l) => l.character_version_id))];
  const cvs = ids.length
    ? await db.select({ id: s.character_versions.id, name: s.character_versions.name }).from(s.character_versions).where(inArray(s.character_versions.id, ids))
    : [];
  const names = new Map(cvs.map((c) => [c.id, c.name]));
  return {
    title: row.version.title,
    lines: row.version.lines.map((l) => ({ character: names.get(l.character_version_id) ?? "Speaker", text: l.text })),
  };
}

/**
 * Turns agent-friendly gaps ({ line: 1-based, word }) into token positions ("li:wi").
 * Each word is matched case-insensitively, ignoring punctuation, at its first unused position.
 */
export function resolveGaps(lines: PdfLine[], gaps: { line: number; word: string }[]) {
  const picked = new Set<string>();
  const missing: { line: number; word: string }[] = [];
  const clean = (w: string) => w.toLowerCase().replace(/[^a-z'’-]/g, "");
  for (const g of gaps) {
    const li = g.line - 1;
    const tokens = lines[li] ? tokenize(lines[li].text) : [];
    const wi = tokens.findIndex((t, i) => blankable(t) && clean(t) === clean(g.word) && !picked.has(`${li}:${i}`));
    if (wi < 0) missing.push(g);
    else picked.add(`${li}:${wi}`);
  }
  return { encoded: [...picked].join(","), missing };
}
