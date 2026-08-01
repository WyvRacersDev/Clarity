/**
 * A8 — client-safe error messages.
 *
 * Raw errors thrown by Postgres or the JS runtime leak internal detail that must
 * never reach a client, e.g.:
 *   - check-constraint / column names
 *   - "invalid input syntax for type uuid"
 *   - "invalid byte sequence 0x00"
 *   - "Cannot read properties of undefined (reading 'map')"
 *
 * Handlers log the REAL error server-side (for debugging) and send back ONLY the
 * generic, action-scoped string produced here. `action` is a short human phrase
 * describing what failed ("save the project", "upload the file"); it contains no
 * runtime/error detail so it is always safe to display.
 *
 *   } catch (error) {
 *     console.error("[saveProject]", error);
 *     socket.emit("projectSaved", { success: false, message: clientError("save the project") });
 *   }
 */
export function clientError(action: string): string {
  return `Something went wrong while trying to ${action}. Please try again.`;
}
