// Production check for /api/audio: uploads a ~9 MB test MP3, signs links with the production
// WORKER_SECRET (pass as PROD_WORKER_SECRET), then tests ranges and a full download.
// Usage: PROD_WORKER_SECRET=... npx tsx scripts/prod-audio-test.mts [cleanup]
import { createHmac } from "node:crypto";

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true, override: true });
const BASE = "https://audio-text-esl.vercel.app";
const KEY = "generations/zz-size-test.mp3";
const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  forcePathStyle: true,
});
if (process.argv[2] === "cleanup") {
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: KEY }));
  console.log("deleted", KEY);
  process.exit(0);
}
const size = 9 * 1024 * 1024 + 123;
const body = Buffer.alloc(size, 0x55);
await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: KEY, Body: body, ContentType: "audio/mpeg" }));

const secret = process.env.PROD_WORKER_SECRET!;
const sign = (dl: string) => {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const s = createHmac("sha256", secret).update(`audio\n${KEY}\n${exp}\n${dl}`).digest("base64url");
  const q = new URLSearchParams({ k: KEY, e: String(exp), s });
  if (dl) q.set("dl", dl);
  return `${BASE}/api/audio?${q}`;
};
const play = sign("");
for (const range of ["bytes=0-1", "bytes=0-", `bytes=${size - 1000}-`]) {
  const r = await fetch(play, { headers: { Range: range } });
  const n = (await r.arrayBuffer()).byteLength;
  console.log(range.padEnd(22), r.status, r.headers.get("content-range"), `${n} bytes`);
}
const d = await fetch(sign("size-test.mp3"));
const n = (await d.arrayBuffer()).byteLength;
console.log("download".padEnd(22), d.status, d.headers.get("content-disposition"), `${n} of ${size} bytes`);
const bad = await fetch(play.replace("s=", "s=x"));
console.log("tampered".padEnd(22), bad.status);
