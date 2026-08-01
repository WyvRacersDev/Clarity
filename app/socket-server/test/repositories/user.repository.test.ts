/**
 * Integration tests for the identity + user repositories.
 *
 * Runs against the REAL local Postgres (docker, port 5433). Every test creates
 * rows under a unique, test-only username/email and deletes them in afterEach,
 * so the demo seed data is never touched and the suite is fully re-runnable.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { sql } from "@src/infrastructure/db.js";
import {
  ensureUser,
  resolveUser,
} from "@src/repositories/identity.repository.js";
import {
  saveUser,
  loadUser,
  listUsers,
  userExists,
  deleteUser,
} from "@src/repositories/user.repository.js";

// Track every username we create so afterEach can clean it up (CASCADE removes
// the user's contacts/projects too).
const created = new Set<string>();

function unique(prefix: string): string {
  return `test_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

async function purge(): Promise<void> {
  for (const username of created) {
    await sql`delete from users where username = ${username}`;
  }
  created.clear();
}

afterEach(purge);
afterAll(async () => {
  await purge();
  await sql.end();
});

describe("identity.repository", () => {
  it("ensureUser creates a user on demand and resolveUser finds it back", async () => {
    const username = unique("ident");
    created.add(username);

    const row = await ensureUser(username);
    expect(row.id).toBeTruthy();
    expect(row.username).toBe(username);
    // Non-email identifier -> synthesized placeholder email.
    expect(row.email).toBe(`${username}@local.clarity`);

    const resolved = await resolveUser(username);
    expect(resolved?.id).toBe(row.id);
  });

  it("ensureUser is idempotent for the same identifier (no duplicate row)", async () => {
    const username = unique("ident_idem");
    created.add(username);

    const first = await ensureUser(username);
    const second = await ensureUser(username);
    expect(second.id).toBe(first.id);

    const count = await sql<Array<{ n: string }>>`
      select count(*) as n from users where username = ${username}
    `;
    expect(Number(count[0]!.n)).toBe(1);
  });

  it("resolveUser returns null for an unknown identifier", async () => {
    const resolved = await resolveUser(unique("missing"));
    expect(resolved).toBeNull();
  });
});

describe("user.repository", () => {
  it("saveUser persists settings + contacts, loadUser returns the serialized contract", async () => {
    const username = unique("user");
    created.add(username);

    const saved = await saveUser({
      type: "User",
      name: username,
      settings: {
        type: "settings",
        recieve_notifications: false,
        allow_invite: true,
        allow_google_calender: false,
      },
      contacts: [
        { type: "contact", name: "Alice", contact_detail: "alice@example.com" },
        { type: "contact", name: "Bob", contact_detail: "bob@example.com" },
      ],
    });
    expect(saved.username).toBe(username);

    const loaded = await loadUser(username);
    expect(loaded).not.toBeNull();
    expect(loaded!.type).toBe("User");
    expect(loaded!.name).toBe(username);
    // Misspelled settings keys are preserved byte-for-byte.
    expect(loaded!.settings.recieve_notifications).toBe(false);
    expect(loaded!.settings.allow_google_calender).toBe(false);
    expect(loaded!.settings.allow_invite).toBe(true);
    // Contacts round-trip.
    expect(loaded!.contacts).toHaveLength(2);
    const details = loaded!.contacts.map((c) => c.contact_detail).sort();
    expect(details).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("saveUser full-replaces contacts on a second save", async () => {
    const username = unique("user_replace");
    created.add(username);

    await saveUser({
      name: username,
      settings: {},
      contacts: [{ name: "Old", contact_detail: "old@example.com" }],
    });
    await saveUser({
      name: username,
      settings: {},
      contacts: [{ name: "New", contact_detail: "new@example.com" }],
    });

    const loaded = await loadUser(username);
    expect(loaded!.contacts).toHaveLength(1);
    expect(loaded!.contacts[0]!.contact_detail).toBe("new@example.com");
  });

  it("userExists / deleteUser reflect presence and removal", async () => {
    const username = unique("user_del");
    created.add(username);

    await ensureUser(username);
    expect(await userExists(username)).toBe(true);

    expect(await deleteUser(username)).toBe(true);
    expect(await userExists(username)).toBe(false);
    created.delete(username); // already gone

    // Deleting again returns false (nothing to remove).
    expect(await deleteUser(username)).toBe(false);
  });

  it("listUsers includes a created user with a project count", async () => {
    const username = unique("user_list");
    created.add(username);
    await ensureUser(username);

    const users = await listUsers();
    const mine = users.find((u) => u.name === username);
    expect(mine).toBeDefined();
    expect(mine!.projectCount).toBe(0);
  });
});
