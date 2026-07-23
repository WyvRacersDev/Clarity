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

export function register(
  _io: Server,
  socket: Socket,
  deps: GatewayDeps,
  userSessions: Map<string, string>
): void {
  const { user_handler } = deps;

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
      console.log(`[Server] 💾 Saving user: "${data.user?.name}"`);
      const result = await user_handler.saveUser(data.user);

      socket.emit("userSaved", {
        success: result.success,
        message: result.message,
        username: data.user?.name,
      });
    } catch (error: any) {
      console.error("Error in saveUser handler:", error);
      socket.emit("userSaved", { success: false, message: `Error: ${error.message}` });
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
      socket.emit(eventName, { success: false, message: `Error: ${error.message}` });
    }
  });

  /**
   * List all users
   */
  socket.on("listUsers", async (data: { requestId?: string }) => {
    const parsed = listUsersSchema.safeParse(data ?? {});
    if (!parsed.success) {
      socket.emit("usersListed", { success: false, users: [], message: formatZodError(parsed.error) });
      return;
    }
    try {
      const result = await user_handler.listUsers();
      socket.emit("usersListed", result);
    } catch (error: any) {
      console.error("Error in listUsers handler:", error);
      socket.emit("usersListed", {
        success: false,
        users: [],
        message: `Error: ${error.message}`,
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
      console.log(`[Server] 🗑️ Deleting user: "${data.username}"`);
      const result = await user_handler.deleteUser(data.username);
      socket.emit("userDeleted", result);
    } catch (error: any) {
      console.error("Error in deleteUser handler:", error);
      socket.emit("userDeleted", { success: false, message: `Error: ${error.message}` });
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
        message: `Error: ${error.message}`,
      });
    }
  });
}
