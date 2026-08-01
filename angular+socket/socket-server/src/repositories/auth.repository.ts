/**
 * Auth repository (R8).
 *
 * Owns the `users` (credential lookups + password-based insert) and
 * `oauth_identities` persistence used by `auth.service.ts`. The service keeps the
 * business logic (bcrypt hashing/compare, JWT issuing, unique-violation → 409
 * mapping, and the find-or-create-from-Google flow) and no longer issues SQL.
 */
import { sql } from "../infrastructure/db.js";
import type { UserRow } from "./identity.repository.js";

/**
 * Insert a new user with a password hash, returning the created row. Rethrows
 * the raw Postgres error (e.g. `23505` unique_violation) so the caller can map
 * it to an HTTP status.
 */
export async function insertUserWithPassword(
  username: string,
  email: string,
  password_hash: string
): Promise<UserRow> {
  const rows = await sql<UserRow[]>`
    insert into users (username, email, password_hash)
    values (${username}, ${email}, ${password_hash})
    returning *
  `;
  return rows[0]!;
}

/** Find a user by an email candidate OR a username candidate (login lookup). */
export async function findUserByEmailOrUsername(
  emailValue: string,
  usernameValue: string
): Promise<UserRow | null> {
  const rows = await sql<UserRow[]>`
    select * from users
    where email = ${emailValue} or username = ${usernameValue}
    limit 1
  `;
  return rows[0] ?? null;
}

/** Find a user by primary key, or null. */
export async function findUserById(id: string): Promise<UserRow | null> {
  const rows = await sql<UserRow[]>`
    select * from users where id = ${id} limit 1
  `;
  return rows[0] ?? null;
}

/** The user id linked to a Google account `sub`, or null when unlinked. */
export async function findUserIdByGoogleSub(sub: string): Promise<string | null> {
  const rows = await sql<Array<{ user_id: string }>>`
    select user_id from oauth_identities
    where provider = 'google' and provider_user_id = ${sub}
    limit 1
  `;
  return rows[0]?.user_id ?? null;
}

/**
 * Link a Google identity (`sub`) to a user in `oauth_identities`. Idempotent:
 * ON CONFLICT (provider, provider_user_id) keeps the existing mapping and just
 * refreshes the recorded email.
 */
export async function linkGoogleIdentity(
  userId: string,
  sub: string,
  email: string
): Promise<void> {
  await sql`
    insert into oauth_identities (user_id, provider, provider_user_id, email)
    values (${userId}, 'google', ${sub}, ${email})
    on conflict (provider, provider_user_id)
    do update set email = excluded.email
  `;
}
