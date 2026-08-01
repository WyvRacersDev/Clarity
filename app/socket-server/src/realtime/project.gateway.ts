/**
 * Project gateway (Phase 6a) — saveProject / loadProject / listProjects /
 * deleteProject, plus the legacy `screenElement` receiver.
 *
 * Behavior-preserving extraction from `src/index.ts`. Event names, response
 * event names, the `eventName` override, the hosted-project broadcasts
 * (`hostedProjectUpdated` / `hostedProjectDeleted`), the JWT-owner override, and
 * the local-project access/filter logic are all unchanged. zod validation is
 * added at the top of each handler and, on failure, responds with the SAME
 * response shape the handler uses but `{ success:false, message }`.
 */
import type { Server, Socket } from "socket.io";
import type { GatewayDeps } from "./types.js";
import {
  saveProjectSchema,
  loadProjectSchema,
  listProjectsSchema,
  deleteProjectSchema,
  formatZodError,
} from "../validation/schemas.js";
import { clientError } from "../lib/clientError.js";
import { projectExistsForOwner } from "../repositories/project.repository.js";
import { can } from "../services/access.service.js";

export function register(io: Server, socket: Socket, deps: GatewayDeps): void {
  const { project_handler, collab, identity } = deps;

  /**
   * Save a project
   * Expected payload: { project: Project, projectType: 'local' | 'hosted' }
   */
  socket.on("saveProject", async (data: { project: any; projectType: "local" | "hosted" }) => {
    const parsed = saveProjectSchema.safeParse(data);
    if (!parsed.success) {
      socket.emit("projectSaved", { success: false, message: formatZodError(parsed.error) });
      return;
    }
    try {
      const projectType = data.projectType || data.project?.project_type || "local";

      // Derive the OWNER from the caller's effective identity (verified JWT, or
      // the legacy identifyUser session in permissive mode) instead of trusting
      // the client-sent owner_name — otherwise any socket can create/impersonate
      // an arbitrary owner (C3). Only truly anonymous sockets (never identified)
      // fall back to the payload's owner_name.
      const effectiveOwner = identity().username;
      if (effectiveOwner && data.project) {
        data.project.owner_name = effectiveOwner;
      }

      // A16: on an explicit CREATE (`expectNew`), refuse to silently overwrite an
      // existing project — return "already exists" feedback instead of upserting.
      // Uses the effective (post-override) owner so the check matches the DB's
      // (owner_id, name, project_type) uniqueness. Edits (no `expectNew`) are
      // unaffected and keep upserting as before.
      const owner = data.project?.owner_name;
      if ((data as any).expectNew === true && owner && data.project?.name) {
        const exists = await projectExistsForOwner(owner, data.project.name, projectType);
        if (exists) {
          socket.emit("projectSaved", {
            success: false,
            message: `A project named "${data.project.name}" already exists. Please choose a different name.`,
          });
          return;
        }
      }

      console.log(`[Server] 💾 Saving project: "${data.project?.name}", Type: "${projectType}", Owner: "${data.project?.owner_name}"`);
      const result = await project_handler.saveProject(data.project, projectType);

      if (result.success) {
        // Send confirmation to the user who saved
        socket.emit("projectSaved", { success: true, message: result.message, projectName: data.project.name });

        // For hosted projects, broadcast the update to all connected clients
        if (projectType === "hosted") {
          const connectedClients = io.sockets.sockets.size;
          console.log(`[Server] 📡 Broadcasting hosted project update: "${data.project.name}" to ${connectedClients} connected clients`);
          io.emit("hostedProjectUpdated", {
            projectName: data.project.name,
            projectType: "hosted",
          });
          console.log(`[Server] ✓ Broadcast sent for hosted project: "${data.project.name}"`);
        } else {
          console.log(`[Server] ℹ️ Project "${data.project.name}" is local, skipping broadcast`);
        }
      } else {
        console.error(`[Server] ✗ Failed to save project "${data.project?.name}":`, result.message);
        socket.emit("projectSaved", { success: false, message: result.message });
      }
    } catch (error: any) {
      console.error("Error in saveProject handler:", error);
      socket.emit("projectSaved", { success: false, message: clientError("save the project") });
    }
  });

  /**
   * Load a project
   * For 'local': only owner can load
   * For 'hosted': anyone can load (public sharing)
   * Expected payload: { projectName: string, projectType: 'local' | 'hosted' }
   */
  socket.on("loadProject", async (data: { projectName: string; projectType: "local" | "hosted"; eventName?: string }) => {
    const parsed = loadProjectSchema.safeParse(data);
    if (!parsed.success) {
      const eventName = data?.eventName || "projectLoaded";
      socket.emit(eventName, { success: false, message: formatZodError(parsed.error) });
      return;
    }
    try {
      // Prefer the verified token identity; fall back to legacy session (permissive).
      const currentUser = identity().username;

      // Use the provided event name if available, otherwise use default
      const eventName = data.eventName || "projectLoaded";

      // N1: authorize VIEW via the role model (owner/admin/editor/viewer or the
      // project's link-share role). Replaces the old local=owner-only / hosted=open
      // rule. `not_found` and `forbidden` both surface as a failure to the client.
      const access = await collab.authorize(
        data.projectName,
        data.projectType,
        currentUser,
        "view"
      );
      if (!access.ok) {
        socket.emit(eventName, { success: false, message: access.message });
        return;
      }

      // Load the project
      const result = await project_handler.loadProject(data.projectName, data.projectType);

      if (result.success && result.project) {
        const role = access.role;
        const serialized = project_handler.serializeProject(result.project);
        serialized.projectType = data.projectType;
        serialized.isOwner = role === "owner";
        serialized.canEdit = can(role, "edit"); // viewers get read-only
        serialized.role = role; // effective role (frontend gates the Share UI on it)

        console.log(`[Server] Sending project: name="${serialized.name}", owner="${serialized.owner_name}", currentUser="${currentUser}", role=${role}`);
        socket.emit(eventName, {
          success: true,
          project: serialized,
          message: result.message,
        });
      } else {
        socket.emit(eventName, { success: false, message: result.message });
      }
    } catch (error: any) {
      console.error("Error in loadProject handler:", error);
      const eventName = data.eventName || "projectLoaded";
      socket.emit(eventName, { success: false, message: clientError("load the project") });
    }
  });

  /**
   * List all projects of a type
   * For 'local': returns only current user's projects
   * For 'hosted': returns ALL hosted projects (anyone can view)
   * Expected payload: { projectType: 'local' | 'hosted' }
   */
  socket.on("listProjects", async (data: { projectType: "local" | "hosted"; requestId?: string }) => {
    const parsed = listProjectsSchema.safeParse(data);
    if (!parsed.success) {
      socket.emit(`projectsListed_${data?.projectType}`, {
        success: false,
        projects: [],
        message: formatZodError(parsed.error),
      });
      return;
    }
    try {
      const currentUser = identity().username;

      if (data.projectType === "hosted") {
        // For hosted projects, show ALL projects (public sharing)
        // Each project includes owner_name so users know who owns it
        const result = await project_handler.listProjects("hosted");
        console.log(`[Server] Listing hosted projects for user: ${currentUser || "anonymous"}`);
        socket.emit(`projectsListed_${data.projectType}`, result);
      } else {
        // N1: local list = projects the user OWNS or is a COLLABORATOR on
        // (each annotated with the user's role). Anonymous/permissive sockets
        // with no identity fall back to the empty-safe owner filter.
        if (currentUser) {
          const result = await project_handler.listProjectsForUser("local", currentUser);
          socket.emit(`projectsListed_${data.projectType}`, result);
        } else {
          // Anonymous/unidentified socket: no identity means no owned or shared
          // local projects to show. (The old code filtered by `currentUser`,
          // which is always undefined here, so the predicate could never match —
          // return the empty result explicitly instead of a dead filter.)
          socket.emit(`projectsListed_${data.projectType}`, {
            success: true,
            projects: [],
            message: "No projects",
          });
        }
      }
    } catch (error: any) {
      console.error("Error in listProjects handler:", error);
      socket.emit(`projectsListed_${data.projectType}`, {
        success: false,
        projects: [],
        message: clientError("list projects"),
      });
    }
  });

  /**
   * Delete a project
   * Expected payload: { projectName: string, projectType: 'local' | 'hosted' }
   */
  socket.on("deleteProject", async (data: { projectName: string; projectType: "local" | "hosted" }) => {
    const parsed = deleteProjectSchema.safeParse(data);
    if (!parsed.success) {
      socket.emit("projectDeleted", { success: false, message: formatZodError(parsed.error) });
      return;
    }
    try {
      // C1: deleting a project is destructive — authorize it. Require `manage`
      // (owner/admin) via the same role model loadProject uses for `view`.
      // Without this any connected socket could delete ANY project by name.
      const currentUser = identity().username;
      const access = await collab.authorize(
        data.projectName,
        data.projectType,
        currentUser,
        "manage"
      );
      if (!access.ok) {
        socket.emit("projectDeleted", { success: false, message: access.message });
        return;
      }

      console.log("🗑️ Deleting project:", data.projectName, "Type:", data.projectType);
      const result = await project_handler.deleteProject(data.projectName, data.projectType);

      // Send confirmation to the user who deleted
      socket.emit("projectDeleted", result);

      // For hosted projects, broadcast the deletion to all connected clients
      if (data.projectType === "hosted" && result.success) {
        console.log(`[Server] Broadcasting hosted project deletion: ${data.projectName}`);
        io.emit("hostedProjectDeleted", {
          projectName: data.projectName,
          projectType: "hosted",
        });
      }
    } catch (error: any) {
      console.error("Error in deleteProject handler:", error);
      socket.emit("projectDeleted", { success: false, message: clientError("delete the project") });
    }
  });
}
