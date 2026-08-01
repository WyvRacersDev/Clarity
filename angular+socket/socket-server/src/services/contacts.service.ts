/**
 * ContactsService (SRP) — Google Contacts import business logic.
 *
 * Behavior-preserving extraction of the ~120-line `importGoogleContacts` handler
 * that used to live inline in `contacts.gateway.ts`. Owns the allow_invite gate,
 * the People API fetch, the dedupe-by-email merge, and persistence, so the
 * gateway keeps only transport concerns (validate → call → ack). The
 * `contactsImported` response shapes are unchanged; the service returns them as
 * plain result objects for the gateway to emit. Unexpected errors are thrown for
 * the gateway to sanitize via `clientError`.
 */
import { google } from "googleapis";
import { getAuthForUser } from "./OAuth.service.js";
import type { UserHandler } from "./user.service.js";

export type ImportContactsResult =
  | { success: true; message: string; totalContacts: number; newContacts: number }
  | { success: false; message: string };

export class ContactsService {
  constructor(private readonly user_handler: UserHandler) {}

  /**
   * Import Google Contacts for a user. Requires the user to have `allow_invite`
   * enabled and a connected Google OAuth client. New contacts (by email) are
   * merged into the user's existing contacts and persisted.
   */
  async importGoogleContacts(username: string): Promise<ImportContactsResult> {
    // First, load the user to check if allow_invite is true
    const userResult = await this.user_handler.loadUser(username);

    if (!userResult.success || !userResult.user) {
      return { success: false, message: `User "${username}" not found` };
    }

    const user = userResult.user;

    // Check if allow_invite is true
    if (!user.settings?.allow_invite) {
      return {
        success: false,
        message: "Contact import is disabled. Enable 'Allow Invites' in settings first.",
      };
    }

    // Get OAuth client for this user
    const authResult = await getAuthForUser(username);
    if (!(authResult instanceof google.auth.OAuth2)) {
      return {
        success: false,
        message: authResult.message + " Please connect to Google first.",
      };
    }
    const userOAuthClient = authResult;

    // Use People API to fetch contacts
    const people = google.people({ version: "v1", auth: userOAuthClient });

    console.log(`[Server] Fetching Google Contacts for ${username}...`);

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
    const currentUserResult = await this.user_handler.loadUser(username);
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
        ...this.user_handler.serializeUser(currentUserResult.user),
        contacts: [...(currentUserResult.user.contacts || []), ...newContacts],
      };

      // Save updated user
      const saveResult = await this.user_handler.saveUser(updatedUserData);
      if (saveResult.success) {
        console.log(`[Server] ✓ Imported ${newContacts.length} new contacts for ${username}`);
        return {
          success: true,
          message: `Successfully imported ${newContacts.length} new contacts`,
          totalContacts: updatedUserData.contacts.length,
          newContacts: newContacts.length,
        };
      }
      return {
        success: false,
        message: `Failed to save contacts: ${saveResult.message}`,
      };
    }
    return {
      success: false,
      message: "Failed to load user data for contact update",
    };
  }
}
