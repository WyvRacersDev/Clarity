/**
 * User repository — SQL CRUD for `users` and their `contacts`.
 *
 * The serialized user contract the frontend expects (see UserHandler) is:
 *   {
 *     type: 'User',
 *     name: <username>,
 *     settings: { type:'settings', recieve_notifications, allow_invite, allow_google_calender },
 *     contacts: [ { type:'contact', name, contact_detail } ],
 *     projectReferences: [ { name, projectType } ],
 *     lastModified: <ISO string>
 *   }
 *
 * IMPORTANT: the model uses the *misspelled* settings keys
 * (`recieve_notifications`, `allow_google_calender`). We persist those exact
 * keys in the `settings` JSONB so the round-trip is byte-compatible with the
 * pre-migration JSON files. The DB column default uses correctly-spelled keys,
 * but we never rely on the default for app-written rows.
 */
import { sql } from "../infrastructure/db.js";
import { ensureUser, resolveUser, type UserRow } from "./identity.repository.js";

export interface ContactRow {
  name: string;
  contact_detail: string;
}

export interface SerializedUser {
  type: "User";
  name: string;
  settings: {
    type: "settings";
    recieve_notifications: boolean;
    allow_invite: boolean;
    allow_google_calender: boolean;
  };
  contacts: Array<{ type: "contact"; name: string; contact_detail: string }>;
  projectReferences: Array<{ name: string; projectType: string }>;
  lastModified: string;
}

/** Normalize whatever settings JSONB we stored into the misspelled-key contract. */
function settingsFromJsonb(raw: any): SerializedUser["settings"] {
  const s = raw ?? {};
  // Tolerate rows written with either spelling (e.g. the DB column default).
  const recieve =
    s.recieve_notifications ?? s.receive_notifications ?? true;
  const allowCal =
    s.allow_google_calender ?? s.allow_google_calendar ?? true;
  const allowInvite = s.allow_invite ?? true;
  return {
    type: "settings",
    recieve_notifications: recieve !== false,
    allow_invite: allowInvite !== false,
    allow_google_calender: allowCal !== false,
  };
}

/** Build the settings JSONB payload, preserving the misspelled keys. */
function settingsToJsonb(incoming: any): Record<string, unknown> {
  const s = incoming ?? {};
  return {
    recieve_notifications:
      (s.recieve_notifications ?? s.receive_notifications ?? true) !== false,
    allow_invite: (s.allow_invite ?? true) !== false,
    allow_google_calender:
      (s.allow_google_calender ?? s.allow_google_calendar ?? true) !== false,
  };
}

async function loadContacts(userId: string): Promise<ContactRow[]> {
  const rows = await sql<ContactRow[]>`
    select name, contact_detail
    from contacts
    where user_id = ${userId}
    order by created_at asc
  `;
  return rows.map((r) => ({ name: r.name, contact_detail: r.contact_detail }));
}

async function loadProjectReferences(
  userId: string
): Promise<Array<{ name: string; projectType: string }>> {
  const rows = await sql<Array<{ name: string; project_type: string }>>`
    select name, project_type
    from projects
    where owner_id = ${userId}
    order by created_at asc
  `;
  return rows.map((r) => ({ name: r.name, projectType: r.project_type }));
}

/**
 * Upsert a user (identified by its name/username) and fully replace its
 * contacts. `incoming` is the serialized-user shape the frontend sends.
 */
export async function saveUser(incoming: any): Promise<UserRow> {
  const username: string = incoming.name;
  const row = await ensureUser(username);

  const settingsJson = settingsToJsonb(incoming.settings);

  await sql`
    update users
    set settings = ${sql.json(settingsJson as any)}
    where id = ${row.id}
  `;

  // Full-replace contacts to mirror the file-based whole-object write.
  const contacts: any[] = Array.isArray(incoming.contacts)
    ? incoming.contacts
    : [];

  await sql.begin(async (tx) => {
    await tx`delete from contacts where user_id = ${row.id}`;
    for (const c of contacts) {
      const name = c?.name ?? "";
      const detail = c?.contact_detail ?? "";
      if (!detail) continue;
      await tx`
        insert into contacts (user_id, name, contact_detail)
        values (${row.id}, ${name}, ${detail})
      `;
    }
  });

  // Re-read to return the freshest row (updated_at bumped by trigger).
  const refreshed = await resolveUser(username);
  return refreshed ?? row;
}

/** Load a user by identifier, returning the serialized contract or null. */
export async function loadUser(identifier: string): Promise<SerializedUser | null> {
  const row = await resolveUser(identifier);
  if (!row) return null;

  const [contacts, projectReferences] = await Promise.all([
    loadContacts(row.id),
    loadProjectReferences(row.id),
  ]);

  return {
    type: "User",
    name: row.username,
    settings: settingsFromJsonb(row.settings),
    contacts: contacts.map((c) => ({
      type: "contact" as const,
      name: c.name,
      contact_detail: c.contact_detail,
    })),
    projectReferences,
    lastModified: row.updated_at.toISOString(),
  };
}

/** List all users (lightweight metadata for the listUsers contract). */
export async function listUsers(): Promise<
  Array<{ name: string; projectCount: number; lastModified: string }>
> {
  const rows = await sql<
    Array<{ username: string; updated_at: Date; project_count: string }>
  >`
    select u.username,
           u.updated_at,
           count(p.id) as project_count
    from users u
    left join projects p on p.owner_id = u.id
    group by u.id
    order by u.username asc
  `;
  return rows.map((r) => ({
    name: r.username,
    projectCount: Number(r.project_count),
    lastModified: r.updated_at.toISOString(),
  }));
}

/** Delete a user by identifier. Returns true if a row was removed. */
export async function deleteUser(identifier: string): Promise<boolean> {
  const row = await resolveUser(identifier);
  if (!row) return false;
  await sql`delete from users where id = ${row.id}`;
  return true;
}

/** Existence check by identifier. */
export async function userExists(identifier: string): Promise<boolean> {
  const row = await resolveUser(identifier);
  return row !== null;
}
