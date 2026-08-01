/**
 * Member repository (N1) — SQL for `project_collaborators`.
 *
 * A collaborator is a registered user granted an explicit role on a project.
 * The project OWNER is NOT stored here (it is `projects.owner_id`); owner rank
 * is applied above this layer by the AccessService. Roles here are the three
 * collaborator roles only: viewer < editor < admin.
 *
 * Plain exported async functions over the shared `sql` handle, matching the
 * other repositories (no classes / DI at this layer).
 */
import { sql } from "../infrastructure/db.js";

/** The three roles a collaborator row can hold (owner is implicit, not stored). */
export type CollaboratorRole = "viewer" | "editor" | "admin";

export interface MemberRow {
  id: string;
  project_id: string;
  user_id: string;
  username: string;
  email: string;
  avatar_url: string | null;
  role: CollaboratorRole;
  created_at: Date;
}

/** All collaborators of a project, joined to their user row, oldest first. */
export async function listMembers(projectId: string): Promise<MemberRow[]> {
  return sql<MemberRow[]>`
    select pc.id, pc.project_id, pc.user_id, pc.role, pc.created_at,
           u.username, u.email, u.avatar_url
    from project_collaborators pc
    join users u on u.id = pc.user_id
    where pc.project_id = ${projectId}
    order by pc.created_at asc
  `;
}

/** A single user's role on a project, or null if they are not a collaborator. */
export async function getMemberRole(
  projectId: string,
  userId: string
): Promise<CollaboratorRole | null> {
  const rows = await sql<Array<{ role: CollaboratorRole }>>`
    select role from project_collaborators
    where project_id = ${projectId} and user_id = ${userId}
    limit 1
  `;
  return rows.length > 0 ? rows[0]!.role : null;
}

/**
 * Add (or, on re-invite, update the role of) a collaborator. Idempotent via the
 * (project_id, user_id) unique constraint. Returns the joined member row.
 */
export async function upsertMember(
  projectId: string,
  userId: string,
  role: CollaboratorRole
): Promise<MemberRow> {
  const rows = await sql<Array<{ id: string }>>`
    insert into project_collaborators (project_id, user_id, role)
    values (${projectId}, ${userId}, ${role})
    on conflict (project_id, user_id) do update set role = excluded.role
    returning id
  `;
  const member = await sql<MemberRow[]>`
    select pc.id, pc.project_id, pc.user_id, pc.role, pc.created_at,
           u.username, u.email, u.avatar_url
    from project_collaborators pc
    join users u on u.id = pc.user_id
    where pc.id = ${rows[0]!.id}
  `;
  return member[0]!;
}

/** Change an existing collaborator's role. Returns true if a row was updated. */
export async function updateMemberRole(
  projectId: string,
  userId: string,
  role: CollaboratorRole
): Promise<boolean> {
  const rows = await sql<Array<{ id: string }>>`
    update project_collaborators set role = ${role}
    where project_id = ${projectId} and user_id = ${userId}
    returning id
  `;
  return rows.length > 0;
}

/** Remove a collaborator. Returns true if a row was removed. */
export async function removeMember(
  projectId: string,
  userId: string
): Promise<boolean> {
  const rows = await sql<Array<{ id: string }>>`
    delete from project_collaborators
    where project_id = ${projectId} and user_id = ${userId}
    returning id
  `;
  return rows.length > 0;
}
