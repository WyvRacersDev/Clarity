/**
 * Applies db/schema.sql to the configured Postgres database.
 *
 *   npm run db:migrate
 *
 * The schema is written to be safe to run repeatedly, so this doubles as a
 * "make sure the database is up to date" command.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sql } from "../src/infrastructure/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "schema.sql");

async function main() {
  console.log("🗄️  Applying schema from", schemaPath);
  const schema = fs.readFileSync(schemaPath, "utf-8");

  await sql.unsafe(schema); // trusted, first-party DDL file
  console.log("✅  Schema applied successfully.");

  await sql.end();
}

main().catch((err) => {
  console.error("❌  Migration failed:", err);
  process.exit(1);
});
