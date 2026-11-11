// Downloads finished conversation MP3s and one voice-preview clip per model from Neon storage.
// Usage: npx tsx scripts/export-audio.mts <out-dir>
import fs from "node:fs";
import path from "node:path";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true, override: true });
const out = process.argv[2];
fs.mkdirSync(path.join(out, "voices"), { recursive: true });
const sql = neon(process.env.DATABASE_URL!);
const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  forcePathStyle: true,
});
const save = async (key: string, file: string) => {
  const r = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  fs.writeFileSync(file, Buffer.from(await r.Body!.transformToByteArray()));
};

const gens = await sql`select g.id, v.version, v.title, g.cost_usd, g.duration_ms from generations g join conversation_versions v on v.id = g.version_id where g.status = 'done' order by v.version`;
for (const g of gens) {
  const name = `conversation-v${g.version}.mp3`;
  await save(`generations/${g.id}.mp3`, path.join(out, name));
  console.log(name, `${Math.round(g.duration_ms / 1000)}s`, `$${Number(g.cost_usd).toFixed(4)}`);
}
const clips = await sql`select distinct on (model) model, voice, audio_key, cost_usd from clips where text like 'Hi there!%' order by model, created_at`;
for (const c of clips) {
  const name = `${c.model.replace(/[/:]/g, "_")}__${c.voice.replace(/[^\w-]+/g, "_")}.mp3`;
  await save(c.audio_key, path.join(out, "voices", name));
}
console.log(clips.length, "voice samples");
