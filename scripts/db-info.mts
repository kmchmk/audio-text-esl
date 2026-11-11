// Read-only: lists tables (with row counts) in whatever database $DATABASE_URL points at.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const tables = await sql`select schemaname, tablename from pg_tables where schemaname not in ('pg_catalog','information_schema') order by 1,2`;
for (const t of tables) {
  const [{ n }] = await sql.query(`select count(*)::int n from "${t.schemaname}"."${t.tablename}"`);
  console.log(`${t.schemaname}.${t.tablename}`.padEnd(40), n);
}
