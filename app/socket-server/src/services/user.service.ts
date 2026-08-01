/**
 * UserHandler — Postgres-backed reimplementation.
 *
 * Public method signatures and returned JSON shapes are kept byte-compatible
 * with the previous file-based version so the frontend socket contract and the
 * callers in index.ts / project.service.ts / agent.service.ts are unaffected —
 * the only change is that the read/write methods are now async (callers await).
 *
 * The serialized-user contract carries the model's *misspelled* settings keys
 * (`recieve_notifications`, `allow_google_calender`); the repository persists
 * those exact keys in the `settings` JSONB.
 */
import * as userRepo from "../repositories/user.repository.js";
import type { SerializedUser } from "../repositories/user.repository.js";
import { clientError } from "../lib/clientError.js";

export class UserHandler {
  /**
   * Serialize a user-like object into the transport shape. Accepts either a
   * hydrated `User` model instance (with toJSON) or an already-serialized object
   * (as produced by loadUser / spread in importGoogleContacts).
   */
  serializeUser(user: any): any {
    if (user && typeof user.toJSON === "function") {
      return user.toJSON();
    }

    const projectRefs = user?.projectReferences || user?.projects || [];
    return {
      type: "User",
      name: user?.name,
      contacts: (user?.contacts || []).map((c: any) => this.serializeContact(c)),
      settings: this.serializeSettings(user?.settings),
      projectReferences: projectRefs.map((p: any) => ({
        name: p.name,
        projectType: p.projectType || p.project_type || "local",
      })),
      lastModified: user?.lastModified || new Date().toISOString(),
    };
  }

  serializeSettings(s: any): any {
    const src = s ?? {};
    if (src.toJSON && typeof src.toJSON === "function") {
      return src.toJSON();
    }
    return {
      type: "settings",
      recieve_notifications:
        src.recieve_notifications !== undefined
          ? src.recieve_notifications
          : true,
      allow_invite: src.allow_invite !== undefined ? src.allow_invite : true,
      allow_google_calender:
        src.allow_google_calender !== undefined
          ? src.allow_google_calender
          : true,
    };
  }

  serializeContact(c: any): any {
    if (!c) return null;
    if (c.toJSON && typeof c.toJSON === "function") {
      return c.toJSON();
    }
    return {
      type: "contact",
      name: c.name,
      contact_detail: c.contact_detail || c,
    };
  }

  /** Upsert a user (and replace contacts). Accepts the serialized-user shape. */
  async saveUser(
    user: any
  ): Promise<{ success: boolean; message: string; path?: string }> {
    try {
      const username = user?.name;
      if (!username) {
        return { success: false, message: "User name is required" };
      }
      // Normalize into the serialized shape before persisting.
      const serialized = this.serializeUser(user);
      await userRepo.saveUser(serialized);
      return {
        success: true,
        message: `User "${username}" saved successfully`,
      };
    } catch (error: any) {
      console.error("[UserHandler] Error saving user:", error);
      return {
        success: false,
        message: clientError("save the user"),
      };
    }
  }

  /**
   * Load a user by identifier. Returns the serialized-user shape as `.user`,
   * which exposes `.name`, `.settings`, `.contacts`, `.projectReferences`.
   */
  async loadUser(
    username: string
  ): Promise<{ success: boolean; user?: SerializedUser; message: string }> {
    try {
      const user = await userRepo.loadUser(username);
      if (user) {
        return {
          success: true,
          user,
          message: `User "${username}" loaded successfully`,
        };
      }
      return { success: false, message: `User "${username}" not found` };
    } catch (error: any) {
      console.error(`[UserHandler] Error loading user "${username}":`, error);
      return {
        success: false,
        message: clientError("load the user"),
      };
    }
  }

  async listUsers(): Promise<{
    success: boolean;
    users: any[];
    message: string;
  }> {
    try {
      const users = await userRepo.listUsers();
      return {
        success: true,
        users,
        message: `Found ${users.length} users`,
      };
    } catch (error: any) {
      console.error("[UserHandler] Error listing users:", error);
      return {
        success: false,
        users: [],
        message: clientError("list users"),
      };
    }
  }

  async deleteUser(
    username: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const removed = await userRepo.deleteUser(username);
      if (!removed) {
        return { success: false, message: `User "${username}" not found` };
      }
      return {
        success: true,
        message: `User "${username}" deleted successfully`,
      };
    } catch (error: any) {
      console.error("[UserHandler] Error deleting user:", error);
      return {
        success: false,
        message: clientError("delete the user"),
      };
    }
  }

  async userExists(username: string): Promise<boolean> {
    try {
      return await userRepo.userExists(username);
    } catch (error: any) {
      console.error("[UserHandler] Error checking user existence:", error);
      return false;
    }
  }
}
