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
import { objects_builder } from "@models/screen-elements.model.js";
import type { GatewayDeps } from "./types.js";
import {
  saveProjectSchema,
  loadProjectSchema,
  listProjectsSchema,
  deleteProjectSchema,
  formatZodError,
} from "../validation/schemas.js";

export function register(io: Server, socket: Socket, deps: GatewayDeps): void {
  const { project_handler, identity } = deps;

  // Receiving method (legacy no-op receiver, kept as-is).
  socket.on("screenElement", (raw) => {
    console.log("📦 Received element from client:", raw);

    // Optional: rebuild for server use
    const element = objects_builder.rebuild(raw); //will be used to store later on (abhi kerna hai)

    // Do something locally (save, log, process)
    // ❌ No broadcasting back
  });

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

      // Derive the OWNER from the verified token when present, ignoring any
      // client-sent owner_name (authorization must not trust the payload).
      // In permissive mode (no token) we keep the payload's owner_name.
      if (socket.data.user && data.project) {
        data.project.owner_name = socket.data.user.username;
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
      socket.emit("projectSaved", { success: false, message: `Error: ${error.message}` });
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

      // Load the project
      const result = await project_handler.loadProject(data.projectName, data.projectType);

      // Use the provided event name if available, otherwise use default
      const eventName = data.eventName || "projectLoaded";

      if (result.success && result.project) {
        // Check access permissions
        const isOwner = result.project.owner_name === currentUser;
        const isHosted = data.projectType === "hosted";

        if (data.projectType === "local" && !isOwner) {
          // Local projects: only owner can access
          socket.emit(eventName, {
            success: false,
            message: `Access denied: You can only view your own local projects`,
          });
          return;
        }

        // Hosted projects: anyone can view
        // Local projects: owner can view/edit
        const serialized = project_handler.serializeProject(result.project);
        serialized.projectType = data.projectType;
        serialized.isOwner = isOwner; // Add flag to indicate if current user is owner
        serialized.canEdit = isOwner || isHosted; // Can edit if owner, or if hosted (for now, allow editing)

        console.log(`[Server] Sending project: name="${serialized.name}", owner="${serialized.owner_name}", currentUser="${currentUser}", isOwner=${isOwner}`);
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
      socket.emit(eventName, { success: false, message: `Error: ${error.message}` });
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
        // For local projects, show only current user's projects
        const result = await project_handler.listProjects("local");
        // Filter by owner if user is identified
        if (currentUser && result.success && result.projects) {
          result.projects = result.projects.filter((p: any) => p.owner_name === currentUser);
        }
        socket.emit(`projectsListed_${data.projectType}`, result);
      }
    } catch (error: any) {
      console.error("Error in listProjects handler:", error);
      socket.emit(`projectsListed_${data.projectType}`, {
        success: false,
        projects: [],
        message: `Error: ${error.message}`,
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
      socket.emit("projectDeleted", { success: false, message: `Error: ${error.message}` });
    }
  });
}
