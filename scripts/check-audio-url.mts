// Creates a signed URL for the newest finished generation and prints it, for checking playback.
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true, override: true });
const sql = neon(process.env.DATABASE_URL!);
const [g] = await sql`select audio_key from generations where status = 'done' order by created_at desc limit 1`;
const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
});
console.log(await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: g.audio_key }), { expiresIn: Number(process.env.EXPIRES || 600) }));
