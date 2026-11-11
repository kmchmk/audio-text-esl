import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "./env";

let client: S3Client | undefined;

function s3() {
  const c = env().s3;
  return (client ??= new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
  }));
}

export async function putObject(key: string, body: Buffer, contentType = "audio/mpeg") {
  await s3().send(new PutObjectCommand({ Bucket: env().s3.bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer> {
  const r = await s3().send(new GetObjectCommand({ Bucket: env().s3.bucket, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

/** Stream an object, optionally a byte range (`bytes=start-end`). */
export async function getObjectStream(key: string, range?: string) {
  const r = await s3().send(new GetObjectCommand({ Bucket: env().s3.bucket, Key: key, Range: range }));
  return {
    body: r.Body!.transformToWebStream(),
    contentType: r.ContentType || "audio/mpeg",
    contentLength: r.ContentLength,
    contentRange: r.ContentRange,
  };
}

// ------------------------------------------------------------ app-served audio URLs
//
// Audio is served from the app's own domain (/api/audio) rather than straight from the
// storage host, so anyone who can open the app can play it (the storage host is blocked on
// some networks, e.g. in mainland China). Links are HMAC-signed and expire.

const mac = (payload: string) => createHmac("sha256", env().workerSecret).update(payload).digest("base64url");
const payloadOf = (key: string, exp: number, dl: string) => `audio\n${key}\n${exp}\n${dl}`;

/** Short-lived app URL for an object. `filename` makes it a download. */
export async function signedUrl(key: string, filename?: string, expiresIn = 3600) {
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const dl = filename ? filename.replace(/[^\w.\- ]+/g, "") : "";
  const q = new URLSearchParams({ k: key, e: String(exp), s: mac(payloadOf(key, exp, dl)) });
  if (dl) q.set("dl", dl);
  return `/api/audio?${q}`;
}

/** Validates an /api/audio query; returns the object key and download name, or null. */
export function verifyAudioUrl(q: URLSearchParams): { key: string; dl: string } | null {
  const key = q.get("k") ?? "";
  const exp = Number(q.get("e"));
  const dl = q.get("dl") ?? "";
  const sig = Buffer.from(q.get("s") ?? "");
  if (!key || !Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  if (!/^(clips|generations)\/[\w-]+\.mp3$/.test(key)) return null;
  const want = Buffer.from(mac(payloadOf(key, exp, dl)));
  return sig.length === want.length && timingSafeEqual(sig, want) ? { key, dl } : null;
}
