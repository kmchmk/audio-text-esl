import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import { env } from "../env";
import * as schema from "./schema";

let db: NeonHttpDatabase<typeof schema> | undefined;

/**
 * Drizzle over Neon's HTTPS driver: one round trip per statement, no pooled TCP
 * connections, which suits serverless functions. Interactive transactions are not
 * available, so multi-step writes use single statements or `db.batch()`.
 * Created lazily so `next build` never needs DATABASE_URL.
 */
export function getDb() {
  return (db ??= drizzle(neon(env().databaseUrl), { schema }));
}

export { schema };
