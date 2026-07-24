import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, firstValueFrom } from 'rxjs';
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

export type ProjectType = 'local' | 'hosted';

@Injectable({ providedIn: 'root' })
export class CollabService {
  private isBrowser: boolean;

  private activeProjectName: string | null = null;
  private activeProjectType: ProjectType | null = null;

  constructor(
    private socketService: SocketService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
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

  emitCreate(gridId: string | undefined, element: any): void {
    if (!this.isJoined || !gridId) return;
    this.socketService.emitElementCreate(this.activeProjectName!, this.activeProjectType!, gridId, element);
  }

  emitMove(elementId: string | undefined, x_pos: number, y_pos: number, x_scale: number, y_scale: number): void {
    if (!this.isJoined || !elementId) return;
    this.socketService.emitElementMove(
      this.activeProjectName!, this.activeProjectType!, elementId, x_pos, y_pos, x_scale, y_scale
    );
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
}
