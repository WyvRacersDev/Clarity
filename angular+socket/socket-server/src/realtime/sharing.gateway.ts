/**
 * Sharing gateway (N1) — access control & sharing for projects.
 *
 * Events (all identify the project by name + type, mirroring the collab gateway):
 *   sharing:get          → members + pending invites + link config      (needs view)
 *   sharing:invite        { email, role? }                              (needs manage)
 *   sharing:updateRole    { userId, role }                             (needs manage)
 *   sharing:removeMember  { userId }                                   (needs manage)
 *   sharing:revokeInvite  { email }                                    (needs manage)
 *   sharing:setLink       { role: none|viewer|editor }                 (needs manage)
 *
 * Authorization is delegated to the AccessService via CollabService.authorize:
 * reads require `view`, mutations require `manage` (owner/admin). After any
 * mutation the fresh state is broadcast to the project room as `sharing:updated`
 * so every open Share panel refreshes, and a newly-added existing user gets a
 * live `project:shared` push in their per-user room (durable history is N2).
 *
 * Transport-only concerns live here (validate → authorize → call SharingService
 * → ack/broadcast/serialize); the business logic is in SharingService (SRP).
 */
import type { Server, Socket } from "socket.io";
import type { ZodType } from "zod";
import type { GatewayDeps } from "./types.js";
import type { MemberRow } from "../repositories/member.repository.js";
import type { InvitationRow } from "../repositories/invitation.repository.js";
import type { ShareState } from "@services/sharing.service.js";
import type { Capability } from "@services/access.service.js";
import {
  sharingGetSchema,
  sharingInviteSchema,
  sharingUpdateRoleSchema,
  sharingRemoveMemberSchema,
  sharingRevokeInviteSchema,
  sharingSetLinkSchema,
  formatZodError,
} from "../validation/schemas.js";
import { clientError } from "../lib/clientError.js";
import { userRoom } from "../services/notification.service.js";

type Ack = (response: any) => void;
type ShareTarget = { projectName: string; projectType: "local" | "hosted" };

function roomKeyFor(projectType: string, projectName: string): string {
  return `${projectType}:${projectName}`;
}

function serializeMember(m: MemberRow) {
  return {
    userId: m.user_id,
    username: m.username,
    email: m.email,
    avatarUrl: m.avatar_url,
    role: m.role,
  };
}

function serializeInvitation(i: InvitationRow) {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    createdAt: i.created_at instanceof Date ? i.created_at.toISOString() : i.created_at,
  };
}

function serializeState(state: ShareState) {
  return {
    members: state.members.map(serializeMember),
    invitations: state.invitations.map(serializeInvitation),
    link: state.link,
  };
}

export function register(io: Server, socket: Socket, deps: GatewayDeps): void {
  const { identity, collab, sharing, notifications } = deps;

  /** Fetch + broadcast the fresh sharing state to the project room; return it. */
  async function broadcastState(projectId: string, target: ShareTarget) {
    const state = serializeState(await sharing.getState(projectId));
    io.to(roomKeyFor(target.projectType, target.projectName)).emit("sharing:updated", {
      projectName: target.projectName,
      projectType: target.projectType,
      ...state,
    });
    return state;
  }

  /**
   * Shared preamble for every sharing event (R6/DRY): validate → authorize the
   * required capability → run `handler` with the resolved project id + caller
   * inside a try/catch. `handler` holds only the op-specific work.
   */
  function onShare<T extends ShareTarget>(
    event: string,
    schema: ZodType<T>,
    capability: Capability,
    action: string,
    handler: (
      data: T,
      ctx: { projectId: string; roomKey: string; username: string | undefined },
      ack?: Ack
    ) => Promise<void>
  ): void {
    socket.on(event, async (data: unknown, ack?: Ack) => {
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        ack?.({ success: false, message: formatZodError(parsed.error) });
        return;
      }
      const payload = parsed.data;
      try {
        const username = identity().username;
        const auth = await collab.authorize(
          payload.projectName,
          payload.projectType,
          username,
          capability
        );
        if (!auth.ok) {
          ack?.({ success: false, message: auth.message });
          return;
        }
        const roomKey = roomKeyFor(payload.projectType, payload.projectName);
        await handler(payload, { projectId: auth.projectId, roomKey, username }, ack);
      } catch (error: any) {
        console.error(`[Sharing] ${event} error:`, error);
        ack?.({ success: false, message: clientError(action) });
      }
    });
  }

  // ─── Read ────────────────────────────────────────────────────────────────
  onShare("sharing:get", sharingGetSchema, "view", "load sharing settings", async (data, ctx, ack) => {
    const state = serializeState(await sharing.getState(ctx.projectId));
    ack?.({ success: true, ...state });
  });

  // ─── Mutations (manage) ────────────────────────────────────────────────────
  onShare("sharing:invite", sharingInviteSchema, "manage", "send the invitation", async (data, ctx, ack) => {
    // invited_by is an audit field; use the verified JWT user id when present.
    const invitedBy = socket.data.user?.id ?? null;
    const result = await sharing.invite(
      ctx.projectId,
      data.email,
      data.role ?? "editor",
      invitedBy
    );
    const state = await broadcastState(ctx.projectId, data);

    if (result.kind === "member") {
      // Live push to the newly-added existing user...
      io.to(userRoom(result.member.username)).emit("project:shared", {
        projectName: data.projectName,
        projectType: data.projectType,
        role: result.member.role,
        by: ctx.username ?? null,
      });
      // ...plus a durable N2 inbox entry (best-effort — never fail the invite).
      try {
        await notifications.notify(io, {
          recipient: result.member.username,
          type: "project_shared",
          actor: ctx.username ?? null,
          projectName: data.projectName,
          projectType: data.projectType,
          title: `${ctx.username ?? "Someone"} shared "${data.projectName}" with you`,
          body: `You were added as ${result.member.role}.`,
        });
      } catch (err) {
        console.error("[Sharing] project_shared notification failed:", err);
      }
      ack?.({ success: true, kind: "member", member: serializeMember(result.member), ...state });
    } else {
      ack?.({
        success: true,
        kind: "invitation",
        invitation: serializeInvitation(result.invitation),
        ...state,
      });
    }
  });

  onShare("sharing:updateRole", sharingUpdateRoleSchema, "manage", "update the role", async (data, ctx, ack) => {
    const ok = await sharing.updateRole(ctx.projectId, data.userId, data.role);
    if (!ok) {
      ack?.({ success: false, message: "Collaborator not found" });
      return;
    }
    const state = await broadcastState(ctx.projectId, data);
    ack?.({ success: true, ...state });
  });

  onShare("sharing:removeMember", sharingRemoveMemberSchema, "manage", "remove the collaborator", async (data, ctx, ack) => {
    const ok = await sharing.removeMember(ctx.projectId, data.userId);
    if (!ok) {
      ack?.({ success: false, message: "Collaborator not found" });
      return;
    }
    const state = await broadcastState(ctx.projectId, data);
    ack?.({ success: true, ...state });
  });

  onShare("sharing:revokeInvite", sharingRevokeInviteSchema, "manage", "revoke the invitation", async (data, ctx, ack) => {
    await sharing.revokeInvitation(ctx.projectId, data.email);
    const state = await broadcastState(ctx.projectId, data);
    ack?.({ success: true, ...state });
  });

  onShare("sharing:setLink", sharingSetLinkSchema, "manage", "update link sharing", async (data, ctx, ack) => {
    await sharing.setLink(ctx.projectId, data.role);
    // broadcastState re-reads the fresh link (role + minted/cleared token).
    const state = await broadcastState(ctx.projectId, data);
    ack?.({ success: true, ...state });
  });
}
