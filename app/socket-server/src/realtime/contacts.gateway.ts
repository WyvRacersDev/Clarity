/**
 * Contacts gateway (Phase 6a) — importGoogleContacts.
 *
 * Transport-only after the R5 SRP split: this validates the payload, resolves
 * the effective username (token-first), delegates the OAuth + People API fetch +
 * dedupe-merge + persistence to `ContactsService`, and emits the
 * `contactsImported` response. The allow_invite gating and response shapes are
 * unchanged; unexpected errors are sanitized here via `clientError`.
 */
import type { Server, Socket } from "socket.io";
import type { GatewayDeps } from "./types.js";
import { importGoogleContactsSchema, formatZodError } from "../validation/schemas.js";
import { clientError } from "../lib/clientError.js";

export function register(_io: Server, socket: Socket, deps: GatewayDeps): void {
  const { contacts } = deps;

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
    const username = socket.data.user?.username ?? rawData?.username;
    if (!username) {
      socket.emit("contactsImported", { success: false, message: "No user identity provided." });
      return;
    }
    console.log(`[Server] 📇 Import Google Contacts requested for: ${username}`);

    try {
      const result = await contacts.importGoogleContacts(username);
      socket.emit("contactsImported", result);
    } catch (error: any) {
      console.error("[Server] Error importing Google Contacts:", error);
      socket.emit("contactsImported", {
        success: false,
        message: clientError("import contacts"),
      });
    }
  });
}
