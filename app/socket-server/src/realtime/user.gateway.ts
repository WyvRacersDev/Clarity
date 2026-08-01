/**
 * User gateway (Phase 6a) — saveUser / loadUser / listUsers / deleteUser /
 * checkUserExists, plus identifyUser and disconnect handling.
 *
 * Behavior-preserving extraction from `src/index.ts`. Event names, response
 * event names, the `eventName` override on loadUser, the token-wins identity in
 * identifyUser, and userSessions bookkeeping are unchanged. zod validation is
 * added at the top of each handler.
 */
import type { Server, Socket } from "socket.io";
import type { GatewayDeps } from "./types.js";
import {
  saveUserSchema,
  loadUserSchema,
  listUsersSchema,
  deleteUserSchema,
  checkUserExistsSchema,
  identifyUserSchema,
  formatZodError,
} from "../validation/schemas.js";
import { clientError } from "../lib/clientError.js";

export function register(_io: Server, socket: Socket, deps: GatewayDeps): void {
  const { user_handler, identity, userSessions } = deps;

  // Register user when they identify themselves.
  // With JWT auth present this is effectively a no-op (identity already trusted).
  socket.on("identifyUser", (data: { username: string }) => {
    const parsed = identifyUserSchema.safeParse(data);
    if (!parsed.success) {
      socket.emit("userIdentified", { success: false, message: formatZodError(parsed.error) });
      return;
    }
    if (socket.data.user) {
      // Token wins — ignore any client-claimed username for authorization.
      console.log(`[Server] identifyUser ignored (token identity: ${socket.data.user.username})`);
      socket.emit("userIdentified", { success: true, username: socket.data.user.username });
      return;
    }
    userSessions.set(socket.id, data.username);
    console.log(`[Server] User identified: ${data.username} (socket: ${socket.id})`);
    socket.emit("userIdentified", { success: true, username: data.username });
  });

  // Clean up on disconnect
  socket.on("disconnect", () => {
    const username = userSessions.get(socket.id);
    if (username) {
      console.log(`[Server] User disconnected: ${username} (socket: ${socket.id})`);
      userSessions.delete(socket.id);
    } else {
      console.log("❌ User disconnected:", socket.id);
    }
  });

  /**
   * Save a user to the backend
   * Expected payload: { user: User object }
   */
  socket.on("saveUser", async (data: { user: any }) => {
    const parsed = saveUserSchema.safeParse(data);
    if (!parsed.success) {
      socket.emit("userSaved", { success: false, message: formatZodError(parsed.error) });
      return;
    }
    try {
      // C2: a socket may only write its OWN user record. When the caller has an
      // effective identity (verified JWT or identifyUser session), the payload's
      // user.name must match it — otherwise any socket could overwrite an
      // arbitrary account. Truly anonymous sockets keep the permissive path (used
      // by the tokenless demo signup) but cannot target a different existing user.
      const self = identity().username;
      if (self && data.user?.name && data.user.name !== self) {
        socket.emit("userSaved", {
          success: false,
          message: "You can only update your own profile.",
        });
        return;
      }

      console.log(`[Server] 💾 Saving user: "${data.user?.name}"`);
      const result = await user_handler.saveUser(data.user);

      socket.emit("userSaved", {
        success: result.success,
        message: result.message,
        username: data.user?.name,
      });
    } catch (error: any) {
      console.error("Error in saveUser handler:", error);
      socket.emit("userSaved", { success: false, message: clientError("save the user") });
    }
  });

  /**
   * Load a user from the backend
   * Expected payload: { username: string }
   */
  socket.on("loadUser", async (data: { username: string; eventName?: string }) => {
    const parsed = loadUserSchema.safeParse(data);
    if (!parsed.success) {
      const eventName = data?.eventName || "userLoaded";
      socket.emit(eventName, { success: false, message: formatZodError(parsed.error) });
      return;
    }
    try {
      console.log(`[Server] 📂 Loading user: "${data.username}"`);
      const result = await user_handler.loadUser(data.username);

      const eventName = data.eventName || "userLoaded";

      if (result.success && result.user) {
        // Serialize the user for transmission
        const serialized = user_handler.serializeUser(result.user);
        socket.emit(eventName, {
          success: true,
          user: serialized,
          message: result.message,
        });
      } else {
        socket.emit(eventName, { success: false, message: result.message });
      }
    } catch (error: any) {
      console.error("Error in loadUser handler:", error);
      const eventName = data.eventName || "userLoaded";
      socket.emit(eventName, { success: false, message: clientError("load the user") });
    }
  });

  /**
   * List users.
   *
   * A15: previously this returned the ENTIRE roster (every username, project
   * count, and last-modified time) to any connected client — a privacy leak with
   * no legitimate consumer (no frontend feature calls listUsers). The response is
   * now SCOPED to the caller's own record: we resolve the effective identity
   * (JWT-first, legacy-session fallback) and return only that user's entry, so no
   * client can enumerate other accounts. Anonymous/unidentified sockets get an
   * empty list. The `{ success, users, message }` contract shape is unchanged.
   */
  socket.on("listUsers", async (data: { requestId?: string }) => {
    const parsed = listUsersSchema.safeParse(data ?? {});
    if (!parsed.success) {
      socket.emit("usersListed", { success: false, users: [], message: formatZodError(parsed.error) });
      return;
    }
    try {
      const self = identity().username;
      if (!self) {
        socket.emit("usersListed", { success: true, users: [], message: "No identity" });
        return;
      }
      const result = await user_handler.listUsers();
      const own = (result.users ?? []).filter((u: any) => u?.name === self);
      socket.emit("usersListed", {
        success: result.success,
        users: own,
        message: result.success ? `Found ${own.length} user${own.length === 1 ? "" : "s"}` : result.message,
      });
    } catch (error: any) {
      console.error("Error in listUsers handler:", error);
      socket.emit("usersListed", {
        success: false,
        users: [],
        message: clientError("list users"),
      });
    }
  });

  /**
   * Delete a user
   * Expected payload: { username: string }
   */
  socket.on("deleteUser", async (data: { username: string }) => {
    const parsed = deleteUserSchema.safeParse(data);
    if (!parsed.success) {
      socket.emit("userDeleted", { success: false, message: formatZodError(parsed.error) });
      return;
    }
    try {
      // C2: deleting an account is self-only. Require an effective identity (no
      // anonymous deletes) and refuse to delete anyone other than the caller —
      // previously any socket could delete ANY user by username.
      const self = identity().username;
      if (!self || self !== data.username) {
        socket.emit("userDeleted", {
          success: false,
          message: "You can only delete your own account.",
        });
        return;
      }

      console.log(`[Server] 🗑️ Deleting user: "${data.username}"`);
      const result = await user_handler.deleteUser(data.username);
      socket.emit("userDeleted", result);
    } catch (error: any) {
      console.error("Error in deleteUser handler:", error);
      socket.emit("userDeleted", { success: false, message: clientError("delete the user") });
    }
  });

  /**
   * Check if a user exists
   * Expected payload: { username: string }
   */
  socket.on("checkUserExists", async (data: { username: string }) => {
    const parsed = checkUserExistsSchema.safeParse(data);
    if (!parsed.success) {
      socket.emit("userExistsResult", { success: false, exists: false, message: formatZodError(parsed.error) });
      return;
    }
    try {
      const exists = await user_handler.userExists(data.username);
      socket.emit("userExistsResult", {
        success: true,
        exists,
        username: data.username,
      });
    } catch (error: any) {
      console.error("Error in checkUserExists handler:", error);
      socket.emit("userExistsResult", {
        success: false,
        exists: false,
        message: clientError("check whether the user exists"),
      });
    }
  });
}
