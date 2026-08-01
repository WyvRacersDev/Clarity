/**
 * N1 access-control + sharing — service/repository integration tests.
 *
 * Runs against the real local Postgres (same as the other backend tests). We
 * exercise the AccessService role model and the SharingService flows directly
 * (no sockets), which covers the repositories underneath them too:
 *   - owner / admin / editor / viewer / link-share / no-access role resolution
 *   - capability gating (view/edit/manage)
 *   - invite existing user → immediate membership
 *   - invite unregistered email → pending invitation, then auto-accept on signup
 *   - role update / remove / revoke / link toggling
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@src/infrastructure/db.js";
import { ensureUser } from "@src/repositories/identity.repository.js";
import { saveProject, findProjectAuth } from "@src/repositories/project.repository.js";
import { getMemberRole } from "@src/repositories/member.repository.js";
import { AccessService, can } from "@services/access.service.js";
import { SharingService } from "@services/sharing.service.js";
import { registerWithPassword } from "@services/auth.service.js";

const access = new AccessService();
const sharing = new SharingService();

const createdUsers = new Set<string>();

function unique(prefix: string): string {
  return `test_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

/** Create a user by username; track for cleanup. Returns the row. */
async function makeUser(prefix: string) {
  const username = unique(prefix);
  const row = await ensureUser(username);
  createdUsers.add(username);
  return row;
}

/** Create an empty project owned by `ownerName`; return its id. */
async function makeProject(ownerName: string, type: "local" | "hosted" = "local") {
  const name = unique("proj");
  await saveProject(
    { owner_name: ownerName, name, projectType: type, grid: [], lastModified: new Date().toISOString() },
    type
  );
  const auth = await findProjectAuth(name, type);
  return { id: auth!.id, name, type };
}

afterEach(async () => {
  for (const username of createdUsers) {
    await sql`delete from users where username = ${username}`;
  }
  createdUsers.clear();
});

afterAll(async () => {
  await sql.end();
});

describe("AccessService role resolution", () => {
  it("owner resolves to 'owner' with full capabilities", async () => {
    const owner = await makeUser("owner");
    const proj = await makeProject(owner.username);

    const res = await access.authorize(proj.name, proj.type, owner.username, "manage");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.role).toBe("owner");
  });

  it("a non-member of a local project has no access", async () => {
    const owner = await makeUser("owner");
    const stranger = await makeUser("stranger");
    const proj = await makeProject(owner.username);

    const view = await access.authorize(proj.name, proj.type, stranger.username, "view");
    expect(view.ok).toBe(false);
    if (!view.ok) expect(view.reason).toBe("forbidden");
  });

  it("missing project reports not_found (distinct from forbidden)", async () => {
    const owner = await makeUser("owner");
    const res = await access.authorize("does_not_exist_" + Date.now(), "local", owner.username, "view");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_found");
  });

  it("a viewer can view but not edit; an editor can edit but not manage", async () => {
    const owner = await makeUser("owner");
    const viewer = await makeUser("viewer");
    const editor = await makeUser("editor");
    const proj = await makeProject(owner.username);

    await sharing.invite(proj.id, viewer.email, "viewer", null);
    await sharing.invite(proj.id, editor.email, "editor", null);

    const v = await access.resolveRole(proj.name, proj.type, viewer.username);
    expect(v?.role).toBe("viewer");
    expect(can(v?.role ?? null, "view")).toBe(true);
    expect(can(v?.role ?? null, "edit")).toBe(false);

    const e = await access.resolveRole(proj.name, proj.type, editor.username);
    expect(can(e?.role ?? null, "edit")).toBe(true);
    expect(can(e?.role ?? null, "manage")).toBe(false);
  });

  it("link sharing grants the public role to any user; disabling revokes it", async () => {
    const owner = await makeUser("owner");
    const stranger = await makeUser("stranger");
    const proj = await makeProject(owner.username); // local, private by default

    // Before: no access.
    expect((await access.resolveRole(proj.name, proj.type, stranger.username))?.role).toBeNull();

    // Enable viewer link sharing → stranger gets viewer.
    await sharing.setLink(proj.id, "viewer");
    const shared = await access.resolveRole(proj.name, proj.type, stranger.username);
    expect(shared?.role).toBe("viewer");

    // Disable → back to no access.
    await sharing.setLink(proj.id, "none");
    expect((await access.resolveRole(proj.name, proj.type, stranger.username))?.role).toBeNull();
  });

  it("effective role is the HIGHEST of membership and link share", async () => {
    const owner = await makeUser("owner");
    const member = await makeUser("member");
    const proj = await makeProject(owner.username);

    await sharing.invite(proj.id, member.email, "viewer", null); // membership viewer
    await sharing.setLink(proj.id, "editor"); // link editor (higher)

    const res = await access.resolveRole(proj.name, proj.type, member.username);
    expect(res?.role).toBe("editor");
  });
});

describe("SharingService flows", () => {
  it("inviting an existing user grants membership immediately", async () => {
    const owner = await makeUser("owner");
    const alice = await makeUser("alice");
    const proj = await makeProject(owner.username);

    const result = await sharing.invite(proj.id, alice.email, "editor", null);
    expect(result.kind).toBe("member");
    expect(await getMemberRole(proj.id, alice.id)).toBe("editor");
  });

  it("inviting an unregistered email creates a pending invite, auto-accepted on signup", async () => {
    const owner = await makeUser("owner");
    const proj = await makeProject(owner.username);
    const email = `${unique("invitee")}@example.com`;

    const result = await sharing.invite(proj.id, email, "editor", null);
    expect(result.kind).toBe("invitation");

    // The invited person registers → invitation converts to a membership.
    const { user } = await registerWithPassword({
      email,
      username: unique("invitee_u"),
      password: "secret123",
    });
    createdUsers.add(user.username);

    expect(await getMemberRole(proj.id, user.id)).toBe("editor");
    const stillPending = await sql`
      select 1 from project_invitations
      where project_id = ${proj.id} and lower(email) = ${email.toLowerCase()} and status = 'pending'
    `;
    expect(stillPending.length).toBe(0);
  });

  it("updateRole, removeMember, and revokeInvitation behave", async () => {
    const owner = await makeUser("owner");
    const bob = await makeUser("bob");
    const proj = await makeProject(owner.username);

    await sharing.invite(proj.id, bob.email, "editor", null);
    expect(await sharing.updateRole(proj.id, bob.id, "admin")).toBe(true);
    expect(await getMemberRole(proj.id, bob.id)).toBe("admin");

    expect(await sharing.removeMember(proj.id, bob.id)).toBe(true);
    expect(await getMemberRole(proj.id, bob.id)).toBeNull();

    const email = `${unique("pend")}@example.com`;
    await sharing.invite(proj.id, email, "viewer", null);
    expect(await sharing.revokeInvitation(proj.id, email)).toBe(true);
  });
});
