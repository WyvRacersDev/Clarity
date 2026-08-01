/**
 * PresenceRegistry — in-memory room membership for collab presence.
 *
 * Extracted from the collab gateway's module-global `roomMembers` map so the
 * state is encapsulated + injectable (testable, and the single place to swap for
 * a shared/Redis-backed store if the server is ever scaled horizontally).
 * Maps roomKey -> (socketId -> { username }).
 */
export class PresenceRegistry {
  private rooms = new Map<string, Map<string, { username: string }>>();

  add(roomKey: string, socketId: string, username: string): void {
    let members = this.rooms.get(roomKey);
    if (!members) {
      members = new Map();
      this.rooms.set(roomKey, members);
    }
    members.set(socketId, { username });
  }

  remove(roomKey: string, socketId: string): void {
    const members = this.rooms.get(roomKey);
    if (!members) return;
    members.delete(socketId);
    if (members.size === 0) this.rooms.delete(roomKey);
  }

  /** Distinct usernames currently in a room (for presence broadcasts). */
  users(roomKey: string): Array<{ username: string }> {
    const members = this.rooms.get(roomKey);
    if (!members) return [];
    const seen = new Set<string>();
    const users: Array<{ username: string }> = [];
    for (const { username } of members.values()) {
      if (!seen.has(username)) {
        seen.add(username);
        users.push({ username });
      }
    }
    return users;
  }
}
