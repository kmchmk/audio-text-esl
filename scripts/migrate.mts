// Applies drizzle/ migrations over Neon's HTTPS driver (works where port 5432 is blocked).
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

config({ path: ".env.local", quiet: true });
await migrate(drizzle(neon(process.env.DATABASE_URL!)), { migrationsFolder: "drizzle" });
console.log("migrations applied");
