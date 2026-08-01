/**
 * Invitation repository (N1) — SQL for `project_invitations`.
 *
 * A pending invitation lets an owner invite an EMAIL that may not have a Clarity
 * account yet. When that email later registers / logs in, the pending invites
 * are converted to memberships (see SharingService.acceptPendingInvitations).
 *
 * One live invite per (project, email): re-inviting the same email upserts the
 * role and re-opens the invite.
 */
import { sql } from "../infrastructure/db.js";
import type { CollaboratorRole } from "./member.repository.js";

export type InvitationStatus = "pending" | "accepted" | "revoked";

export interface InvitationRow {
  id: string;
  project_id: string;
  email: string;
  role: CollaboratorRole;
  invited_by: string | null;
  token: string;
  status: InvitationStatus;
  created_at: Date;
  accepted_at: Date | null;
}

/** Pending invitations for a project (for the Share panel), newest first. */
export async function listPendingInvitations(
  projectId: string
): Promise<InvitationRow[]> {
  return sql<InvitationRow[]>`
    select * from project_invitations
    where project_id = ${projectId} and status = 'pending'
    order by created_at desc
  `;
}

/**
 * Create or re-open a pending invitation for (project, email) with a role.
 * Idempotent on (project_id, email): an existing row is reset to pending with
 * the new role (and a fresh token). Email is stored lower-cased for matching.
 */
export async function upsertInvitation(
  projectId: string,
  email: string,
  role: CollaboratorRole,
  invitedBy: string | null
): Promise<InvitationRow> {
  const normalized = email.trim().toLowerCase();
  const rows = await sql<InvitationRow[]>`
    insert into project_invitations (project_id, email, role, invited_by, status)
    values (${projectId}, ${normalized}, ${role}, ${invitedBy}, 'pending')
    on conflict (project_id, email) do update
      set role        = excluded.role,
          invited_by  = excluded.invited_by,
          status      = 'pending',
          token       = gen_random_uuid(),
          accepted_at = null
    returning *
  `;
  return rows[0]!;
}

/** All still-pending invitations addressed to an email, across every project. */
export async function pendingInvitationsForEmail(
  email: string
): Promise<InvitationRow[]> {
  const normalized = email.trim().toLowerCase();
  return sql<InvitationRow[]>`
    select * from project_invitations
    where lower(email) = ${normalized} and status = 'pending'
  `;
}

/** Mark an invitation accepted (once the invitee has a membership). */
export async function markInvitationAccepted(id: string): Promise<void> {
  await sql`
    update project_invitations
    set status = 'accepted', accepted_at = now()
    where id = ${id}
  `;
}

/** Revoke a pending invitation by (project, email). Returns true if one changed. */
export async function revokeInvitation(
  projectId: string,
  email: string
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const rows = await sql<Array<{ id: string }>>`
    update project_invitations set status = 'revoked'
    where project_id = ${projectId} and lower(email) = ${normalized}
      and status = 'pending'
    returning id
  `;
  return rows.length > 0;
}
