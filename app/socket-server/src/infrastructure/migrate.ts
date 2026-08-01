/**
 * Versioned database migration runner.
 *
 *   npm run db:migrate            (tsx src/infrastructure/migrate.ts)
 *   node dist/infrastructure/migrate.js
 *
 * Replaces the old "re-apply one schema.sql" approach with ordered, versioned
 * migrations. Each `db/migrations/NNNN_name.sql` file is applied at most once and
 * recorded in a `schema_migrations` bookkeeping table.
 *
 * Behaviour:
 *   1. Ensure `schema_migrations (version text pk, applied_at timestamptz)`.
 *   2. Read every `db/migrations/*.sql`, sorted by filename (so 0001 < 0002 …).
 *   3. Apply any whose `version` (the filename, e.g. "0001_init.sql") is not yet
 *      recorded — each inside its own transaction — and record it.
 *   4. Log what ran; a no-op (with a clear message) when already up to date.
 *
 * Existing databases: `0001_init.sql` is the current schema written with
 * IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS everywhere, so
 * re-applying it to an already-provisioned DB is harmless — it simply does
 * nothing and gets recorded. No special detection needed.
 */
import "../loadenv.js"; // load socket-server/.env before config/db read process.env
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sql } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// src/infrastructure/migrate.ts -> ../../db/migrations
// dist/infrastructure/migrate.js also resolves to <server>/db/migrations because
// db/ is a sibling of src/ and dist/ (it is not compiled).
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "db", "migrations");

/** Ordered list of migration versions (filenames) discovered on disk. */
function listMigrations(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // lexical sort; zero-padded numeric prefixes order correctly
}

async function ensureMigrationsTable(): Promise<void> {
  await sql`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )
  `;
}

async function appliedVersions(): Promise<Set<string>> {
  const rows = await sql<Array<{ version: string }>>`
    select version from schema_migrations
  `;
  return new Set(rows.map((r) => r.version));
}

export async function main(): Promise<void> {
  console.log("🗄️  Running migrations from", MIGRATIONS_DIR);

  await ensureMigrationsTable();

  const all = listMigrations();
  const done = await appliedVersions();
  const pending = all.filter((v) => !done.has(v));

  if (pending.length === 0) {
    console.log("✅  Database is up to date (%d migration(s) applied).", all.length);
    return;
  }

  console.log("⏳  %d pending migration(s): %s", pending.length, pending.join(", "));

  for (const version of pending) {
    const filePath = path.join(MIGRATIONS_DIR, version);
    const ddl = fs.readFileSync(filePath, "utf-8");

    // Each migration runs in its own transaction: on failure it rolls back and
    // the version is NOT recorded, so the next run retries it.
    await sql.begin(async (tx) => {
      await tx.unsafe(ddl); // trusted, first-party DDL file
      await tx`insert into schema_migrations (version) values (${version})`;
    });

    console.log("   ✅  applied %s", version);
  }

  console.log("✅  Applied %d migration(s).", pending.length);
}

// Run only when this module is the process entry point (tsx or
// `node dist/infrastructure/migrate.js`). Compare full resolved paths sans
// extension so that merely importing this module never triggers a run (a
// basename compare would false-match any other file also named "migrate").
const invoked = process.argv[1]
  ? path.resolve(process.argv[1]).replace(/\.[cm]?[jt]s$/, "")
  : "";
const self = fileURLToPath(import.meta.url).replace(/\.[cm]?[jt]s$/, "");
if (invoked === self) {
  main()
    .then(() => sql.end())
    .catch(async (err) => {
      console.error("❌  Migration failed:", err);
      await sql.end();
      process.exit(1);
    });
}
