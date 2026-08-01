import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subscription, firstValueFrom } from 'rxjs';
import { SocketService } from './socket.service';

/**
 * Phase 6b — CollabService
 *
 * Thin wrapper over the granular Socket.IO realtime events for live
 * multi-user editing of a project canvas. It is ADDITIVE: the existing
 * whole-project save/load (SocketService.saveProject/loadProject) stays the
 * durable persistence path. This service only carries the low-latency,
 * non-durable "granular ops" (element create/move/update/delete + presence +
 * cursors) between peers.
 *
 * Payload shapes match the backend exactly:
 *  - element:create  { projectName, projectType, gridId, element }
 *  - element:move    { projectName, projectType, elementId, x_pos, y_pos, x_scale, y_scale }
 *  - element:update  { projectName, projectType, elementId, content }   (JSONB merge patch)
 *  - element:delete  { projectName, projectType, elementId }
 *  - cursor:move     { projectName, projectType, x, y }
 * Remote listeners:
 *  - element:created { gridId, element }
 *  - element:moved   { elementId, x_pos, y_pos, x_scale, y_scale }
 *  - element:updated { elementId, content }
 *  - element:deleted { elementId }
 *  - presence:update { room, users: [{ username }] }
 *  - cursor:moved    { username, x, y }
 */
export interface PresenceUser { username: string; }
export interface RemoteCursor { username: string; x: number; y: number; }
/** A2/A3 — task comment shape (mirrors backend comment.repository.ts). */
export interface TaskComment {
  id: string;
  taskId: string;
  author: string;
  body: string;
  created_at: string; // ISO 8601
}

/** E6 — canvas comment pin shape (mirrors backend elementComment.repository.ts). */
export interface ElementComment {
  id: string;
  projectId: string;
  elementId: string;
  author: string;
  body: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  created_at: string; // ISO 8601
}

/** E8 — a canvas version (mirrors backend snapshot.repository.ts SnapshotMeta). */
export interface ProjectSnapshot {
  id: string;
  projectId: string;
  createdBy: string | null;
  label: string | null;
  kind: 'auto' | 'manual';
  elementCount: number;
  createdAt: string; // ISO 8601
}

export type ProjectType = 'local' | 'hosted';

/** E10 — a coalesced element transform pending replay after a reconnect. */
interface PendingTransform { x_pos: number; y_pos: number; x_scale: number; y_scale: number; }

@Injectable({ providedIn: 'root' })
export class CollabService {
  private isBrowser: boolean;

  private activeProjectName: string | null = null;
  private activeProjectType: ProjectType | null = null;

  // E10 — reconnect/optimistic state.
  // `connected` tracks live socket status; while offline, moves are DROPPED on
  // the wire (volatile) and their latest per-element transform is stashed in
  // `pendingMoves` so we can replay the final state (last-write-wins) once the
  // socket comes back — no lost moves, no stale intermediate frames.
  private connected = false;
  private readonly pendingMoves = new Map<string, PendingTransform>();
  private connSubs: Subscription[] = [];

  constructor(
    private socketService: SocketService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.connected = this.socketService.isConnected();
      this.wireConnectionHandling();
    }
  }

  /**
   * E10: track connect/disconnect and, on every (re)connection, re-join the
   * active room (so remote ops + presence resume — Socket.IO gives a fresh
   * server-side socket that isn't in any room) and replay the coalesced final
   * transform of anything moved while offline.
   *
   * Note: captures the current socket instance; a manual SocketService.reconnect()
   * (login/logout) swaps the socket, which is a full page-context change anyway.
   */
  private wireConnectionHandling(): void {
    this.connSubs.push(
      this.socketService.onDisconnect().subscribe(() => { this.connected = false; }),
      this.socketService.onConnect().subscribe(() => {
        this.connected = true;
        void this.resyncAfterReconnect();
      })
    );
  }

  private async resyncAfterReconnect(): Promise<void> {
    if (!this.isJoined) return;
    try {
      await firstValueFrom(
        this.socketService.joinProjectRoom(this.activeProjectName!, this.activeProjectType!)
      );
    } catch {
      return; // still offline / rejected; the next reconnect retries
    }
    // Replay coalesced final positions (absolute, last-write-wins) — one emit
    // per element, no stale intermediate frames.
    for (const [elementId, t] of this.pendingMoves) {
      this.socketService.emitElementMove(
        this.activeProjectName!, this.activeProjectType!, elementId, t.x_pos, t.y_pos, t.x_scale, t.y_scale
      );
    }
    this.pendingMoves.clear();
  }

  /** E10: idempotency key for a create — collapses reconnect replays server-side. */
  private newOpId(): string {
    try {
      if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) return (crypto as any).randomUUID();
    } catch { /* fall through */ }
    return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  /** Whether a granular-collab room is currently joined. */
  get isJoined(): boolean {
    return this.activeProjectName !== null && this.activeProjectType !== null;
  }

  // --- Room lifecycle --------------------------------------------------------

  /**
   * Join the collaboration room for a project. Returns the initial presence
   * ack (`{ users: [{ username }] }`). Safe no-op during SSR.
   */
  async joinRoom(projectName: string, projectType: ProjectType): Promise<PresenceUser[]> {
    if (!this.isBrowser) return [];
    // Switching projects: drop any moves still pending for the previous room so
    // they can't replay into the newly-joined one.
    this.pendingMoves.clear();
    this.activeProjectName = projectName;
    this.activeProjectType = projectType;
    try {
      const ack = await firstValueFrom(this.socketService.joinProjectRoom(projectName, projectType));
      return this.extractUsers(ack);
    } catch {
      return [];
    }
  }

  /** Leave the currently-joined room (if any). */
  leaveRoom(): void {
    if (!this.isBrowser) return;
    if (this.activeProjectName && this.activeProjectType) {
      this.socketService.leaveProjectRoom(this.activeProjectName, this.activeProjectType);
    }
    this.activeProjectName = null;
    this.activeProjectType = null;
    this.pendingMoves.clear();
  }

  private extractUsers(payload: any): PresenceUser[] {
    const users = payload?.users ?? payload?.presence ?? [];
    if (!Array.isArray(users)) return [];
    return users
      .map((u: any) => (typeof u === 'string' ? { username: u } : { username: u?.username }))
      .filter((u: PresenceUser) => !!u.username);
  }

  // --- Emit local ops --------------------------------------------------------
  // Each guards on a joined room so single-user / SSR flows are unaffected.

  /**
   * Create an element granularly and resolve with the server's authoritative
   * element (carrying its stable `id`), or null when no room is joined / the
   * server rejects it. Callers set that id on their local element so its later
   * move/edit/delete ops sync (and a following whole-project save reuses it,
   * leaving a single row rather than a duplicate).
   */
  async emitCreate(gridId: string | undefined, element: any): Promise<any | null> {
    if (!this.isBrowser || !this.isJoined || !gridId) return null;
    try {
      // E10: tag with an idempotency key so a create buffered across a reconnect
      // (and flushed on rejoin) can't insert a duplicate row server-side.
      const opId = this.newOpId();
      const ack = await firstValueFrom(
        this.socketService.emitElementCreate(this.activeProjectName!, this.activeProjectType!, gridId, element, opId)
      );
      return ack?.success ? ack.element ?? null : null;
    } catch {
      return null;
    }
  }

  emitMove(elementId: string | undefined, x_pos: number, y_pos: number, x_scale: number, y_scale: number): void {
    if (!this.isJoined || !elementId) return;
    if (this.connected) {
      // Online: send now (volatile) and drop any stale pending entry for this id.
      this.pendingMoves.delete(elementId);
      this.socketService.emitElementMove(
        this.activeProjectName!, this.activeProjectType!, elementId, x_pos, y_pos, x_scale, y_scale
      );
    } else {
      // Offline: coalesce to the latest intended transform; replayed on reconnect.
      this.pendingMoves.set(elementId, { x_pos, y_pos, x_scale, y_scale });
    }
  }

  emitContentUpdate(elementId: string | undefined, content: any): void {
    if (!this.isJoined || !elementId) return;
    this.socketService.emitElementUpdateContent(this.activeProjectName!, this.activeProjectType!, elementId, content);
  }

  emitDelete(elementId: string | undefined): void {
    if (!this.isJoined || !elementId) return;
    this.socketService.emitElementDelete(this.activeProjectName!, this.activeProjectType!, elementId);
  }

  emitCursor(x: number, y: number): void {
    if (!this.isJoined) return;
    this.socketService.emitCursorMove(this.activeProjectName!, this.activeProjectType!, x, y);
  }

  // --- Remote streams --------------------------------------------------------

  onRemoteCreated(): Observable<{ gridId: string; element: any }> {
    return this.socketService.onElementCreated();
  }

  onRemoteMoved(): Observable<{ elementId: string; x_pos: number; y_pos: number; x_scale: number; y_scale: number }> {
    return this.socketService.onElementMoved();
  }

  onRemoteUpdated(): Observable<{ elementId: string; content: any }> {
    return this.socketService.onElementUpdated();
  }

  onRemoteDeleted(): Observable<{ elementId: string }> {
    return this.socketService.onElementDeleted();
  }

  onPresence(): Observable<PresenceUser[]> {
    return new Observable<PresenceUser[]>(observer => {
      const sub = this.socketService.onPresenceUpdate().subscribe((data: any) => {
        observer.next(this.extractUsers(data));
      });
      return () => sub.unsubscribe();
    });
  }

  onRemoteCursor(): Observable<RemoteCursor> {
    return this.socketService.onCursorMoved();
  }

  // --- B3: collaborative text (Yjs) ------------------------------------------
  // Room-scoped wrappers over the ydoc:* events. Payloads carry base64-encoded
  // Yjs updates; the caller (TextDocEditorComponent) owns the Y.Doc + binding.

  /**
   * Sync a Text_document's Y.Doc with the server. Sends the local state vector,
   * resolves with `{ update, stateVector }` (both base64) — apply `update` to the
   * local doc, then send back the local diff against `stateVector`. Null off-room.
   */
  async syncYdoc(elementId: string, stateVector: string): Promise<{ update: string; stateVector: string } | null> {
    if (!this.isBrowser || !this.isJoined || !elementId) return null;
    try {
      const ack = await firstValueFrom(
        this.socketService.emitYdocSync(this.activeProjectName!, this.activeProjectType!, elementId, stateVector)
      );
      if (ack?.success) return { update: ack.update, stateVector: ack.stateVector };
      return null;
    } catch {
      return null;
    }
  }

  /** Send a base64 Yjs update for an element. */
  emitYdocUpdate(elementId: string | undefined, update: string): void {
    if (!this.isJoined || !elementId) return;
    this.socketService.emitYdocUpdate(this.activeProjectName!, this.activeProjectType!, elementId, update);
  }

  /** Send a base64 Yjs awareness update for an element (remote cursors). */
  emitYdocAwareness(elementId: string | undefined, update: string): void {
    if (!this.isJoined || !elementId) return;
    this.socketService.emitYdocAwareness(this.activeProjectName!, this.activeProjectType!, elementId, update);
  }

  /** Remote Yjs document updates (`{ elementId, update }`). */
  onYdocUpdated(): Observable<{ elementId: string; update: string }> {
    return this.socketService.onYdocUpdated();
  }

  /** Remote Yjs awareness updates (`{ elementId, update }`). */
  onYdocAwareness(): Observable<{ elementId: string; update: string }> {
    return this.socketService.onYdocAwareness();
  }

  // --- A3: task comments -----------------------------------------------------
  // Thin wrappers over the ack-based add/list events + the room broadcast.
  // `projectName`/`projectType` are taken from the currently-joined room so
  // callers only pass the task id + body (author is derived server-side).

  /** Add a comment to a task. Resolves with the created comment or throws. */
  async addComment(taskId: string, body: string): Promise<TaskComment | null> {
    if (!this.isBrowser || !this.isJoined) return null;
    const ack = await firstValueFrom(
      this.socketService.emitTaskCommentAdd(this.activeProjectName!, this.activeProjectType!, taskId, body)
    );
    if (ack?.success) return ack.comment as TaskComment;
    throw new Error(ack?.message || 'Failed to add comment');
  }

  /** List comments for a task (oldest-first). */
  async listComments(taskId: string): Promise<TaskComment[]> {
    if (!this.isBrowser || !this.isJoined) return [];
    const ack = await firstValueFrom(
      this.socketService.emitTaskCommentList(this.activeProjectName!, this.activeProjectType!, taskId)
    );
    if (ack?.success && Array.isArray(ack.comments)) return ack.comments as TaskComment[];
    return [];
  }

  /** Live stream of comments added by anyone in the room (`{ comment }`). */
  onCommentAdded(): Observable<TaskComment> {
    return new Observable<TaskComment>(observer => {
      const sub = this.socketService.onTaskCommentAdded().subscribe((data: any) => {
        if (data?.comment) observer.next(data.comment as TaskComment);
      });
      return () => sub.unsubscribe();
    });
  }

  // --- E6: element comments (canvas comment pins) ----------------------------
  // Wrappers over the ack-based create/list/resolve/delete events + the room
  // broadcasts. projectName/projectType come from the currently-joined room, so
  // callers pass only the element id / comment id / body.

  /** Pin a comment to an element. Resolves with the created comment or throws. */
  async createElementComment(elementId: string, body: string): Promise<ElementComment> {
    if (!this.isBrowser || !this.isJoined) throw new Error('Not in a collab room');
    const ack = await firstValueFrom(
      this.socketService.emitCommentCreate(this.activeProjectName!, this.activeProjectType!, elementId, body)
    );
    if (ack?.success) return ack.comment as ElementComment;
    throw new Error(ack?.message || 'Failed to add comment');
  }

  /** List every comment pin for the joined project (oldest-first). */
  async listElementComments(): Promise<ElementComment[]> {
    if (!this.isBrowser || !this.isJoined) return [];
    try {
      const ack = await firstValueFrom(
        this.socketService.emitCommentList(this.activeProjectName!, this.activeProjectType!)
      );
      if (ack?.success && Array.isArray(ack.comments)) return ack.comments as ElementComment[];
      return [];
    } catch {
      return [];
    }
  }

  /** Resolve/re-open a comment. Resolves with the updated comment or throws. */
  async resolveElementComment(commentId: string, resolved: boolean): Promise<ElementComment> {
    if (!this.isBrowser || !this.isJoined) throw new Error('Not in a collab room');
    const ack = await firstValueFrom(
      this.socketService.emitCommentResolve(this.activeProjectName!, this.activeProjectType!, commentId, resolved)
    );
    if (ack?.success) return ack.comment as ElementComment;
    throw new Error(ack?.message || 'Failed to resolve comment');
  }

  /** Delete a comment. Throws on failure. */
  async deleteElementComment(commentId: string): Promise<void> {
    if (!this.isBrowser || !this.isJoined) throw new Error('Not in a collab room');
    const ack = await firstValueFrom(
      this.socketService.emitCommentDelete(this.activeProjectName!, this.activeProjectType!, commentId)
    );
    if (!ack?.success) throw new Error(ack?.message || 'Failed to delete comment');
  }

  /** Live stream of comments created by anyone in the room. */
  onElementCommentCreated(): Observable<ElementComment> {
    return new Observable<ElementComment>(observer => {
      const sub = this.socketService.onCommentCreated().subscribe((data: any) => {
        if (data?.comment) observer.next(data.comment as ElementComment);
      });
      return () => sub.unsubscribe();
    });
  }

  /** Live stream of comments resolved/re-opened by anyone in the room. */
  onElementCommentResolved(): Observable<ElementComment> {
    return new Observable<ElementComment>(observer => {
      const sub = this.socketService.onCommentResolved().subscribe((data: any) => {
        if (data?.comment) observer.next(data.comment as ElementComment);
      });
      return () => sub.unsubscribe();
    });
  }

  /** Live stream of comment deletions by anyone in the room. */
  onElementCommentDeleted(): Observable<{ commentId: string; elementId: string }> {
    return new Observable<{ commentId: string; elementId: string }>(observer => {
      const sub = this.socketService.onCommentDeleted().subscribe((data: any) => {
        if (data?.commentId) observer.next({ commentId: data.commentId, elementId: data.elementId });
      });
      return () => sub.unsubscribe();
    });
  }

  // --- E8: canvas version history / restore ----------------------------------
  // Wrappers over the ack-based snapshot events + the room broadcasts.
  // projectName/projectType come from the currently-joined room.

  /** Save a named manual checkpoint of the current canvas. Throws on failure. */
  async createSnapshot(label?: string): Promise<ProjectSnapshot> {
    if (!this.isBrowser || !this.isJoined) throw new Error('Not in a collab room');
    const ack = await firstValueFrom(
      this.socketService.emitSnapshotCreate(this.activeProjectName!, this.activeProjectType!, label)
    );
    if (ack?.success) return ack.snapshot as ProjectSnapshot;
    throw new Error(ack?.message || 'Failed to save version');
  }

  /** List the joined project's version timeline (newest-first). */
  async listSnapshots(): Promise<ProjectSnapshot[]> {
    if (!this.isBrowser || !this.isJoined) return [];
    try {
      const ack = await firstValueFrom(
        this.socketService.emitSnapshotList(this.activeProjectName!, this.activeProjectType!)
      );
      if (ack?.success && Array.isArray(ack.snapshots)) return ack.snapshots as ProjectSnapshot[];
      return [];
    } catch {
      return [];
    }
  }

  /** Restore the canvas to a stored version (full-replace). Throws on failure. */
  async restoreSnapshot(snapshotId: string): Promise<void> {
    if (!this.isBrowser || !this.isJoined) throw new Error('Not in a collab room');
    const ack = await firstValueFrom(
      this.socketService.emitSnapshotRestore(this.activeProjectName!, this.activeProjectType!, snapshotId)
    );
    if (!ack?.success) throw new Error(ack?.message || 'Failed to restore version');
  }

  /** Live stream of new versions saved by anyone in the room. */
  onSnapshotCreated(): Observable<ProjectSnapshot> {
    return new Observable<ProjectSnapshot>(observer => {
      const sub = this.socketService.onSnapshotCreated().subscribe((data: any) => {
        if (data?.snapshot) observer.next(data.snapshot as ProjectSnapshot);
      });
      return () => sub.unsubscribe();
    });
  }

  /** Live stream of restores performed by a PEER (the initiator reloads locally). */
  onSnapshotRestored(): Observable<{ snapshotId: string; restoredBy: string }> {
    return new Observable<{ snapshotId: string; restoredBy: string }>(observer => {
      const sub = this.socketService.onSnapshotRestored().subscribe((data: any) => {
        if (data?.snapshotId) observer.next({ snapshotId: data.snapshotId, restoredBy: data.restoredBy });
      });
      return () => sub.unsubscribe();
    });
  }
}
