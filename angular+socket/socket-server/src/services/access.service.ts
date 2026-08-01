/**
 * AccessService (N1) — the single source of truth for "who can do what" on a
 * project.
 *
 * Effective role hierarchy (high → low):
 *   owner   — the projects.owner_id user; full control incl. delete.
 *   admin   — a collaborator who can also manage sharing.
 *   editor  — a collaborator who can edit content.
 *   viewer  — read-only collaborator.
 *
 * A user's effective role is the HIGHEST of: owner (implicit), their explicit
 * collaborator role, and the project's link-share role ("anyone with the link").
 *
 * Capabilities map to a minimum rank:
 *   view   ≥ viewer     edit ≥ editor     manage ≥ admin
 *
 * This class owns ONLY the authorization decision (SRP). It reads through the
 * repositories and is injected into the collab/sharing layers (DIP) so gateways
 * never re-implement the rule inline.
 */
import {
  findProjectAuth,
  type LinkShareRole,
} from "../repositories/project.repository.js";
import { getMemberRole, type CollaboratorRole } from "../repositories/member.repository.js";
import { resolveUser } from "../repositories/identity.repository.js";

export type Role = "owner" | CollaboratorRole; // owner | admin | editor | viewer
export type Capability = "view" | "edit" | "manage";
export type ProjectType = "local" | "hosted";

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };
const REQUIRED: Record<Capability, number> = { view: 1, edit: 2, manage: 3 };

/** True when `role` (if any) is high enough for `capability`. */
export function can(role: Role | null, capability: Capability): boolean {
  return role != null && RANK[role] >= REQUIRED[capability];
}

/** Boolean capability flags for a role — handy for shaping a client payload. */
export function capabilities(role: Role | null): {
  role: Role | null;
  canView: boolean;
  canEdit: boolean;
  canManage: boolean;
} {
  return {
    role,
    canView: can(role, "view"),
    canEdit: can(role, "edit"),
    canManage: can(role, "manage"),
  };
}

export type AuthResult =
  | { ok: true; projectId: string; role: Role }
  | { ok: false; message: string; reason: "not_found" | "forbidden" };

function forbiddenMessage(capability: Capability): string {
  switch (capability) {
    case "view":
      return "Access denied: you don't have access to this project";
    case "edit":
      return "Access denied: you have view-only access to this project";
    case "manage":
      return "Access denied: only the owner or an admin can manage sharing";
  }
}

export class AccessService {
  /**
   * Resolve a user's effective role on a project, or null when they have no
   * access at all. `owner_username`/`link_share_role` come from a single
   * lightweight lookup; a membership check runs only when the caller is a known
   * (non-owner) user.
   */
  async resolveRole(
    projectName: string,
    projectType: ProjectType,
    username: string | undefined
  ): Promise<{ projectId: string; role: Role | null } | null> {
    const proj = await findProjectAuth(projectName, projectType);
    if (!proj) return null;
    const role = await this.roleFor(
      proj.id,
      proj.owner_username,
      proj.link_share_role,
      username
    );
    return { projectId: proj.id, role };
  }

  private async roleFor(
    projectId: string,
    ownerUsername: string,
    linkShareRole: LinkShareRole,
    username: string | undefined
  ): Promise<Role | null> {
    if (username && username === ownerUsername) return "owner";

    let memberRole: CollaboratorRole | null = null;
    if (username) {
      const user = await resolveUser(username);
      if (user) memberRole = await getMemberRole(projectId, user.id);
    }

    const linkRole: Role | null = linkShareRole === "none" ? null : linkShareRole;

    // Highest of the applicable roles.
    const candidates: Role[] = [];
    if (memberRole) candidates.push(memberRole);
    if (linkRole) candidates.push(linkRole);
    if (candidates.length === 0) return null;
    return candidates.reduce((best, r) => (RANK[r] > RANK[best] ? r : best));
  }

  /**
   * Authorize `username` for `capability` on the named project. Distinguishes a
   * missing project (`not_found`) from insufficient rights (`forbidden`) so
   * callers can craft the right message. On success returns the project id and
   * the caller's effective role.
   */
  async authorize(
    projectName: string,
    projectType: ProjectType,
    username: string | undefined,
    capability: Capability = "edit"
  ): Promise<AuthResult> {
    const resolved = await this.resolveRole(projectName, projectType, username);
    if (!resolved) {
      return { ok: false, reason: "not_found", message: "Project not found" };
    }
    if (!can(resolved.role, capability)) {
      return {
        ok: false,
        reason: "forbidden",
        message: forbiddenMessage(capability),
      };
    }
    return { ok: true, projectId: resolved.projectId, role: resolved.role! };
  }
}
