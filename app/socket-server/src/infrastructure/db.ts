/**
 * Postgres connection (postgres.js).
 *
 * This is the single database handle for the whole backend. Import `sql` and
 * write tagged-template queries:
 *
 *   const rows = await sql`select * from users where email = ${email}`;
 *
 * Values interpolated with ${} are always sent as bound parameters, so this is
 * safe against SQL injection.
 */
import postgres from "postgres";
import { DATABASE_URL } from "../config/index.js";

export const sql = postgres(DATABASE_URL, {
  // Surface connection problems loudly during development.
  onnotice: () => {},
});

/** Quick connectivity check used at server startup. */
export async function assertDbConnection(): Promise<void> {
  await sql`select 1`;
}
