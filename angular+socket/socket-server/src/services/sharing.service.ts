/**
 * SharingService (N1) — orchestrates the collaborator / invitation / link-share
 * flows for a project.
 *
 * SRP: it holds the "how sharing changes" business logic (resolve an email to an
 * existing user → add a membership, otherwise record a pending invitation; role
 * changes; revokes; link toggling; and auto-accepting pending invites on
 * sign-up). DIP: it depends on the repositories, not on SQL or the gateway.
 *
 * Transport (validation, room broadcasts, notifications) stays in the gateway.
 */
import {
  listMembers,
  upsertMember,
  updateMemberRole,
  removeMember,
  type CollaboratorRole,
  type MemberRow,
} from "../repositories/member.repository.js";
import {
  listPendingInvitations,
  upsertInvitation,
  pendingInvitationsForEmail,
  markInvitationAccepted,
  revokeInvitation,
  type InvitationRow,
} from "../repositories/invitation.repository.js";
import {
  getProjectLinkShare,
  setProjectLinkShare,
  type LinkShareRole,
} from "../repositories/project.repository.js";
import { resolveUser } from "../repositories/identity.repository.js";

export interface ShareState {
  members: MemberRow[];
  invitations: InvitationRow[];
  link: { role: LinkShareRole; token: string | null };
}

/** Result of an invite: either an immediate membership or a pending invitation. */
export type InviteResult =
  | { kind: "member"; member: MemberRow }
  | { kind: "invitation"; invitation: InvitationRow };

/** A project a user was just auto-added to by accepting a pending invitation. */
export interface AcceptedInvite {
  projectId: string;
  role: CollaboratorRole;
}

export class SharingService {
  /** Full sharing state for the Share panel. */
  async getState(projectId: string): Promise<ShareState> {
    const [members, invitations, link] = await Promise.all([
      listMembers(projectId),
      listPendingInvitations(projectId),
      getProjectLinkShare(projectId),
    ]);
    return {
      members,
      invitations,
      link: link
        ? { role: link.link_share_role, token: link.link_share_token }
        : { role: "none", token: null },
    };
  }

  /**
   * Invite an email at a role. If the email already has an account, grant the
   * membership immediately; otherwise record a pending invitation that is
   * auto-accepted when that email first registers/logs in.
   */
  async invite(
    projectId: string,
    email: string,
    role: CollaboratorRole,
    invitedByUserId: string | null
  ): Promise<InviteResult> {
    const existing = await resolveUser(email);
    if (existing) {
      const member = await upsertMember(projectId, existing.id, role);
      return { kind: "member", member };
    }
    const invitation = await upsertInvitation(projectId, email, role, invitedByUserId);
    return { kind: "invitation", invitation };
  }

  /** Change a collaborator's role. Returns true if a member row was updated. */
  updateRole(
    projectId: string,
    userId: string,
    role: CollaboratorRole
  ): Promise<boolean> {
    return updateMemberRole(projectId, userId, role);
  }

  /** Remove a collaborator. Returns true if a member row was removed. */
  removeMember(projectId: string, userId: string): Promise<boolean> {
    return removeMember(projectId, userId);
  }

  /** Revoke a pending invitation by email. Returns true if one changed. */
  revokeInvitation(projectId: string, email: string): Promise<boolean> {
    return revokeInvitation(projectId, email);
  }

  /** Set link sharing; returns the effective share token (null when disabled). */
  setLink(projectId: string, role: LinkShareRole): Promise<string | null> {
    return setProjectLinkShare(projectId, role);
  }

  /**
   * Accept every pending invitation addressed to a user's email (called the
   * first time they register / log in). Idempotent: memberships upsert and
   * invitations flip to 'accepted'. Returns the projects they were added to so
   * the caller can notify them.
   */
  async acceptPendingInvitations(user: {
    id: string;
    email: string;
  }): Promise<AcceptedInvite[]> {
    const pending = await pendingInvitationsForEmail(user.email);
    const accepted: AcceptedInvite[] = [];
    for (const inv of pending) {
      await upsertMember(inv.project_id, user.id, inv.role);
      await markInvitationAccepted(inv.id);
      accepted.push({ projectId: inv.project_id, role: inv.role });
    }
    return accepted;
  }
}
