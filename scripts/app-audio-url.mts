// Prints an app-served signed audio path (/api/audio?...) for the newest generation.
// Run with NODE_OPTIONS=--conditions=react-server. Pass "dl" to get a download link.
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true, override: true });
const { signedUrl } = await import("../src/lib/storage.ts");
const sql = neon(process.env.DATABASE_URL!);
const [g] = await sql`select audio_key from generations where status = 'done' order by created_at desc limit 1`;
console.log(await signedUrl(g.audio_key, process.argv[2] === "dl" ? "test.mp3" : undefined));
