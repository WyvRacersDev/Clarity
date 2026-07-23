/**
 * Contacts gateway (Phase 6a) — importGoogleContacts.
 *
 * Behavior-preserving extraction from `src/index.ts`. The token-first username
 * resolution, allow_invite gating, People API fetch, dedupe-by-email merge, and
 * the `contactsImported` response shapes are unchanged. zod validation is added
 * on the raw payload (before token override) so a malformed payload without a
 * token identity is rejected consistently.
 */
import type { Server, Socket } from "socket.io";
import { google } from "googleapis";
import { getAuthForUser } from "@services/OAuth.service.js";
import type { GatewayDeps } from "./types.js";
import { importGoogleContactsSchema, formatZodError } from "../validation/schemas.js";

export function register(_io: Server, socket: Socket, deps: GatewayDeps): void {
  const { user_handler } = deps;

  /**
   * Import Google Contacts for a user
   * Expected payload: { username: string }
   * Only works if user has allow_invite set to true
   */
  socket.on("importGoogleContacts", async (rawData: { username: string }) => {
    // Validate against the effective payload: token identity may supply username,
    // so accept the raw payload if either it validates OR a token identity exists.
    const parsed = importGoogleContactsSchema.safeParse(rawData);
    if (!parsed.success && !socket.data.user?.username) {
      socket.emit("contactsImported", { success: false, message: formatZodError(parsed.error) });
      return;
    }
    // Prefer the verified token identity; calendar/contacts key on email.
    const data = {
      username: socket.data.user?.username ?? rawData.username,
    };
    console.log(`[Server] 📇 Import Google Contacts requested for: ${data.username}`);

    try {
      // First, load the user to check if allow_invite is true
      const userResult = await user_handler.loadUser(data.username);

      if (!userResult.success || !userResult.user) {
        socket.emit("contactsImported", {
          success: false,
          message: `User "${data.username}" not found`,
        });
        return;
      }

      const user = userResult.user;

      // Check if allow_invite is true
      if (!user.settings?.allow_invite) {
        socket.emit("contactsImported", {
          success: false,
          message: "Contact import is disabled. Enable 'Allow Invites' in settings first.",
        });
        return;
      }

      // Get OAuth client for this user
      const authResult = await getAuthForUser(data.username);
      if (!(authResult instanceof google.auth.OAuth2)) {
        socket.emit("contactsImported", {
          success: false,
          message: authResult.message + " Please connect to Google first.",
        });
        return;
      }
      const userOAuthClient = authResult;

      // Use People API to fetch contacts
      const people = google.people({ version: "v1", auth: userOAuthClient });

      console.log(`[Server] Fetching Google Contacts for ${data.username}...`);

      const response = await people.people.connections.list({
        resourceName: "people/me",
        pageSize: 1000,
        personFields: "names,emailAddresses,phoneNumbers",
      });

      const connections = response.data.connections || [];
      console.log(`[Server] Found ${connections.length} raw contacts`);

      // Extract contacts with emails
      const importedContacts = connections
        .filter((person: any) => person.emailAddresses && person.emailAddresses.length > 0)
        .map((person: any) => ({
          contact_detail: person.emailAddresses?.[0]?.value || "",
          name: person.names?.[0]?.displayName || "Unknown",
          phone: person.phoneNumbers?.[0]?.value || "",
        }))
        .filter((contact: any) => contact.contact_detail);

      console.log(`[Server] Extracted ${importedContacts.length} contacts with emails`);

      // Load current user data and update contacts
      const currentUserResult = await user_handler.loadUser(data.username);
      if (currentUserResult.success && currentUserResult.user) {
        // Merge contacts (avoid duplicates based on email)
        const existingEmails = new Set(
          (currentUserResult.user.contacts || []).map((c: any) => c.contact_detail?.toLowerCase())
        );

        const newContacts = importedContacts.filter(
          (c: any) => !existingEmails.has(c.contact_detail?.toLowerCase())
        );

        // Prepare updated user data
        const updatedUserData = {
          ...user_handler.serializeUser(currentUserResult.user),
          contacts: [...(currentUserResult.user.contacts || []), ...newContacts],
        };

        // Save updated user
        const saveResult = await user_handler.saveUser(updatedUserData);
        if (saveResult.success) {
          console.log(`[Server] ✓ Imported ${newContacts.length} new contacts for ${data.username}`);
          socket.emit("contactsImported", {
            success: true,
            message: `Successfully imported ${newContacts.length} new contacts`,
            totalContacts: updatedUserData.contacts.length,
            newContacts: newContacts.length,
          });
        } else {
          socket.emit("contactsImported", {
            success: false,
            message: `Failed to save contacts: ${saveResult.message}`,
          });
        }
      } else {
        socket.emit("contactsImported", {
          success: false,
          message: "Failed to load user data for contact update",
        });
      }
    } catch (error: any) {
      console.error("[Server] Error importing Google Contacts:", error);
      socket.emit("contactsImported", {
        success: false,
        message: `Failed to import contacts: ${error.message}`,
      });
    }
  });
}
