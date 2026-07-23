/**
 * Identity repository.
 *
 * The linchpin that maps the free-form `owner_name`/`username` string used
 * throughout the legacy socket contract (sometimes a display name, sometimes an
 * email — see the frontend `data.service.ts`) onto a concrete `users` row UUID.
 *
 *   resolveUser(identifier) — read-only lookup, returns the row or null.
 *   ensureUser(identifier)  — create-on-demand, always returns a row.
 *
 * Matching strategy: if the identifier contains "@" we treat it as an email
 * first (then fall back to username); otherwise we treat it as a username first
 * (then fall back to email). Both `email` and `username` are NOT NULL UNIQUE, so
 * `ensureUser` synthesizes whichever field the caller did not supply.
 */
import { sql } from "../infrastructure/db.js";

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string | null;
  avatar_url: string | null;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/** Read-only resolution of an identifier to a users row (or null). */
export async function resolveUser(identifier: string): Promise<UserRow | null> {
  if (!identifier) return null;
  const hasAt = identifier.includes("@");

  // Order the two candidate columns by which is more likely given the shape.
  const [first, second] = hasAt
    ? (["email", "username"] as const)
    : (["username", "email"] as const);

  const byFirst = await sql<UserRow[]>`
    select * from users where ${sql(first)} = ${identifier} limit 1
  `;
  if (byFirst.length > 0) return byFirst[0]!;

  const bySecond = await sql<UserRow[]>`
    select * from users where ${sql(second)} = ${identifier} limit 1
  `;
  if (bySecond.length > 0) return bySecond[0]!;

  return null;
}

/**
 * Create-on-demand: return the existing row for `identifier`, or insert a new
 * one. The missing NOT NULL UNIQUE field is synthesized:
 *   - identifier is an email  -> username = identifier (email doubles as name)
 *   - identifier is a name    -> email    = `<name>@local.clarity` placeholder
 */
export async function ensureUser(identifier: string): Promise<UserRow> {
  const existing = await resolveUser(identifier);
  if (existing) return existing;

  const hasAt = identifier.includes("@");
  const username = identifier;
  const email = hasAt ? identifier : `${identifier}@local.clarity`;

  // ON CONFLICT on username guards against a race where the same display name
  // was inserted between the resolveUser read and this insert.
  const rows = await sql<UserRow[]>`
    insert into users (username, email)
    values (${username}, ${email})
    on conflict (username) do update set username = excluded.username
    returning *
  `;
  return rows[0]!;
}
