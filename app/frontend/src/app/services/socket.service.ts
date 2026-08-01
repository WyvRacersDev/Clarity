import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { Screen_Element } from '../../../../shared_models/models/screen-elements.model';
import { getServerConfig } from '../config/server.config';
import { validate } from '../schemas/validate';
import {
  INBOUND_SCHEMAS,
  elementUpdateSchema,
  taskUpdateSchema,
  userActivitySchema,
} from '../schemas/socket-schemas';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket | null = null;
  private readonly isBrowser: boolean;
  private serverUrl: string;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);

    // Get server URL (will be evaluated in browser context)
    this.serverUrl = this.isBrowser ? getServerConfig() : 'http://localhost:3000';

    // Only initialize socket in browser environment (not during SSR)
    if (this.isBrowser) {
      // Phase 3: send the backend-issued JWT in the handshake if we have one.
      // If there's no token, connect exactly as before (permissive fallback).
      const token = this.getAuthToken();
      this.socket = token
        ? io(this.serverUrl, { auth: { token } })
        : io(this.serverUrl);
      this.setupConnection();
    }
  }

  /**
   * Check if socket is available (browser environment)
   */
  private isSocketAvailable(): boolean {
    return this.isBrowser && this.socket !== null;
  }

  /**
   * Reconnect the socket so the current `auth_token` (Phase 3 JWT) is sent in
   * the handshake. Call this after login/logout, since the token is read only
   * at connect time.
   */
  reconnect(): void {
    if (!this.isBrowser) return;

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    const token = this.getAuthToken();
    this.socket = token
      ? io(this.serverUrl, { auth: { token } })
      : io(this.serverUrl);
    this.setupConnection();
  }

  private setupConnection(): void {
    if (!this.isSocketAvailable()) return;

    this.socket!.on('connect', () => {
      console.log('Connected to server:', this.socket!.id);
      // Identify user when connected
      const currentUser = this.getCurrentUser();
      if (currentUser) {
        this.identifyUser(currentUser);
      }
    });

    this.socket!.on('disconnect', () => {
      console.log('Disconnected from server');
    });
  }

  /**
   * Identify the current user to the server
   */
  identifyUser(username: string): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('identifyUser', { username });
    console.log(`[SocketService] Identified user: ${username}`);
  }

  /**
   * Get current user from localStorage (helper method)
   * Safe for SSR - checks if localStorage is available
   */
  private getCurrentUser(): string | null {
    try {
      // Check if we're in a browser environment (localStorage is not available in SSR)
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return null;
      }
      const currentUserName = localStorage.getItem('current_user_name');
      return currentUserName;
    } catch (error) {
      console.error('Error getting current user:', error);
    }
    return null;
  }

  /**
   * Read the backend-issued JWT from localStorage (Phase 3).
   * Returns null when absent so the socket connects as before (permissive).
   */
  private getAuthToken(): string | null {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return null;
      }
      return localStorage.getItem('auth_token');
    } catch (error) {
      console.error('Error getting auth token:', error);
    }
    return null;
  }

  // Emit screen element updates
  emitElementUpdate(element: Screen_Element, projectId: string, gridId: string): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('elementUpdate', {
      element: element.toJSON(),
      projectId,
      gridId
    });
  }

  // Listen for element updates
  onElementUpdate(): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.complete();
        return;
      }
      this.socket!.on('elementUpdate', (data) => {
        const result = validate(elementUpdateSchema, data, 'elementUpdate');
        if (result.ok) observer.next(result.data);
      });
    });
  }

  // Join a project room for collaboration
  joinProject(projectId: string, userId: number): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('joinProject', { projectId, userId });
  }

  // Leave a project room
  leaveProject(projectId: string): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('leaveProject', { projectId });
  }

  // Listen for user activity in project
  onUserActivity(): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.complete();
        return;
      }
      this.socket!.on('userActivity', (data) => {
        const result = validate(userActivitySchema, data, 'userActivity');
        if (result.ok) observer.next(result.data);
      });
    });
  }

  // Emit task updates
  emitTaskUpdate(task: any, projectId: string): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('taskUpdate', { task, projectId });
  }

  // Listen for task updates
  onTaskUpdate(): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.complete();
        return;
      }
      this.socket!.on('taskUpdate', (data) => {
        const result = validate(taskUpdateSchema, data, 'taskUpdate');
        if (result.ok) observer.next(result.data);
      });
    });
  }

  // Disconnect socket
  disconnect(): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.disconnect();
  }

  // Get socket instance
  getSocket(): Socket | null {
    return this.isSocketAvailable() ? this.socket : null;
  }

  /** Whether the underlying socket is currently connected. */
  isConnected(): boolean {
    return this.isSocketAvailable() && this.socket!.connected;
  }

  /**
   * E10: fires on every successful (re)connection, including Socket.IO's own
   * auto-reconnects. Consumers (CollabService) use it to re-join rooms and
   * replay work that was buffered while offline.
   */
  onConnect(): Observable<void> {
    return new Observable<void>(observer => {
      if (!this.isSocketAvailable()) { observer.complete(); return; }
      const handler = () => observer.next();
      this.socket!.on('connect', handler);
      return () => { if (this.isSocketAvailable()) this.socket!.off('connect', handler); };
    });
  }

  /** E10: fires whenever the socket drops (network blip, server restart, etc.). */
  onDisconnect(): Observable<void> {
    return new Observable<void>(observer => {
      if (!this.isSocketAvailable()) { observer.complete(); return; }
      const handler = () => observer.next();
      this.socket!.on('disconnect', handler);
      return () => { if (this.isSocketAvailable()) this.socket!.off('disconnect', handler); };
    });
  }

  /**
   * H2: emit `emitEvent` and settle on the first `responseEvent`, ALWAYS removing
   * the listener afterwards — on success AND on timeout. The previous pattern
   * registered `.once(responseEvent)` alongside a separate timeout that errored
   * without ever calling `.off`; a late/failed response then left a dangling
   * listener that would consume the NEXT request's response (cross-talk). Use for
   * the fixed-name response events (projectSaved / userSaved / usersListed / …).
   */
  private emitAwait(
    emitEvent: string,
    payload: any,
    responseEvent: string,
    label: string,
    timeoutMs = 10000
  ): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        if (this.isSocketAvailable()) this.socket!.off(responseEvent, handler);
      };
      const handler = (response: any) => {
        if (settled) return;
        settled = true;
        cleanup();
        observer.next(response);
        observer.complete();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        observer.error(new Error(`${label} timeout`));
        observer.complete();
      }, timeoutMs);
      this.socket!.on(responseEvent, handler);
      this.socket!.emit(emitEvent, payload);
    });
  }

  // === Project Management Methods ===

  /**
   * Save a project to the server
   * @param project The project object to save
   * @param projectType 'local' or 'hosted'
   * @returns Observable that emits the save result
   */
  saveProject(project: any, projectType: 'local' | 'hosted', expectNew = false): Observable<any> {
    // A16: `expectNew` marks a CREATE — the server rejects it with an
    // "already exists" message instead of silently overwriting a duplicate.
    return this.emitAwait(
      'saveProject',
      { project, projectType, expectNew },
      'projectSaved',
      'Save project'
    );
  }

  /**
   * Load a project from the server
   * @param projectName Name of the project to load
   * @param projectType 'local' or 'hosted'
   * @returns Observable that emits the loaded project
   */
  loadProject(projectName: string, projectType: 'local' | 'hosted'): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('Load project timeout'));
        observer.complete();
      }, 10000);

      // Use a unique event name per project to avoid mix-ups when loading in parallel
      // Create a safe event name from project name and type
      const safeName = projectName.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
      const eventName = `projectLoaded_${projectType}_${safeName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const handler = (response: any) => {
        // The eventName is unique per request (name + timestamp + random), so any
        // response on it belongs to THIS call — settle on the first one regardless
        // of success. Previously a `success:false` (or a name mismatch) response
        // was ignored, leaving the request to hang the full 10s timeout, which
        // stalls the whole projects list behind one failed load.
        clearTimeout(timeout);
        this.socket!.off(eventName, handler);
        observer.next(response);
        observer.complete();
      };

      this.socket!.on(eventName, handler);
      this.socket!.emit('loadProject', { projectName, projectType, eventName });
    });
  }

  /**
   * List all projects of a specific type
   * @param projectType 'local' or 'hosted'
   * @returns Observable that emits the list of projects
   */
  listProjects(projectType: 'local' | 'hosted'): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('List projects timeout'));
        observer.complete();
      }, 10000); // 10 second timeout

      // Use a unique event name per project type to avoid mix-ups when loading in parallel
      const eventName = `projectsListed_${projectType}`;

      this.socket!.once(eventName, (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });

      this.socket!.emit('listProjects', { projectType });
    });
  }

  /**
   * Delete a project from the server
   * @param projectName Name of the project to delete
   * @param projectType 'local' or 'hosted'
   * @returns Observable that emits the delete result
   */
  deleteProject(projectName: string, projectType: 'local' | 'hosted'): Observable<any> {
    return this.emitAwait(
      'deleteProject',
      { projectName, projectType },
      'projectDeleted',
      'Delete project'
    );
  }
  // === User Management Methods ===

  /**
   * Save a user to the server
   * @param user The user object to save
   * @returns Observable that emits the save result
   */
  saveUser(user: any): Observable<any> {
    return this.emitAwait('saveUser', { user }, 'userSaved', 'Save user');
  }

  /**
   * Load a user from the server
   * @param username Username to load
   * @returns Observable that emits the loaded user
   */
  loadUser(username: string): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('Load user timeout'));
        observer.complete();
      }, 10000);

      const eventName = `userLoaded_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      this.socket!.once(eventName, (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });

      this.socket!.emit('loadUser', { username, eventName });
    });
  }

  /**
   * List all users
   * @returns Observable that emits the list of users
   */
  listUsers(): Observable<any> {
    return this.emitAwait('listUsers', {}, 'usersListed', 'List users');
  }
  /**
   * Delete a user from the server
   * @param username Username to delete
   * @returns Observable that emits the delete result
   */
  deleteUser(username: string): Observable<any> {
    return this.emitAwait('deleteUser', { username }, 'userDeleted', 'Delete user');
  }
  /**
  * Check if a user exists on the server
  * @param username Username to check
  * @returns Observable that emits whether the user exists
  */
  checkUserExists(username: string): Observable<any> {
    return this.emitAwait(
      'checkUserExists',
      { username },
      'userExistsResult',
      'Check user exists'
    );
  }
  /**
   * Upload a file (image or video) for a project
   * @param projectName Name of the project
   * @param projectType 'local' or 'hosted'
   * @param fileName Original file name
   * @param fileData Base64 data URL of the file
   * @param fileType 'image' or 'video'
   * @returns Observable that emits the upload result with the local file path
   */
  uploadFile(projectName: string, projectType: 'local' | 'hosted', fileName: string, fileData: string, fileType: 'image' | 'video'): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('File upload timeout'));
        observer.complete();
      }, 60000); // 60 second timeout for large files

      const eventName = `fileUploaded_${projectName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      this.socket!.once(eventName, (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });

      this.socket!.emit('uploadFile', {
        projectName,
        projectType,
        fileName,
        fileData,
        fileType,
        eventName
      });
    });
  }

  /**
   * Delete a file (image or video) for a project
   * @param projectName Name of the project
   * @param projectType 'local' or 'hosted'
   * @param filePath Relative path to the file (e.g., "projectname_assets/file.png")
   * @returns Observable that emits the delete result
   */
  deleteFile(projectName: string, projectType: 'local' | 'hosted', filePath: string): Observable<any> {
    // Delete file from server filesystem
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('File delete timeout'));
        observer.complete();
      }, 10000); // 10 second timeout

      const eventName = `fileDeleted_${projectName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      this.socket!.once(eventName, (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });

      this.socket!.emit('deleteFile', {
        projectName,
        projectType,
        filePath,
        eventName
      });
    });
  }

  /**
   * Listen for hosted project updates (broadcasted to all clients)
   * @returns Observable that emits when a hosted project is updated
   */
  onHostedProjectUpdated(): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        console.warn('[SocketService] Socket not available for hostedProjectUpdated listener');
        observer.complete();
        return;
      }

      console.log('[SocketService] Setting up hostedProjectUpdated listener');
      const handler = (data: any) => {
        console.log('[SocketService] ✓ Received hostedProjectUpdated event:', data);
        observer.next(data);
      };

      this.socket!.on('hostedProjectUpdated', handler);
      console.log('[SocketService] ✓ hostedProjectUpdated listener registered');

      // Return cleanup function
      return () => {
        if (this.isSocketAvailable()) {
          console.log('[SocketService] Cleaning up hostedProjectUpdated listener');
          this.socket!.off('hostedProjectUpdated', handler);
        }
      };
    });
  }

  /**
   * Listen for hosted project deletions (broadcasted to all clients)
   * @returns Observable that emits when a hosted project is deleted
   */
  onHostedProjectDeleted(): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        console.warn('[SocketService] Socket not available for hostedProjectDeleted listener');
        observer.complete();
        return;
      }

      console.log('[SocketService] Setting up hostedProjectDeleted listener');
      const handler = (data: any) => {
        console.log('[SocketService] ✓ Received hostedProjectDeleted event:', data);
        observer.next(data);
      };

      this.socket!.on('hostedProjectDeleted', handler);
      console.log('[SocketService] ✓ hostedProjectDeleted listener registered');

      // Return cleanup function
      return () => {
        if (this.isSocketAvailable()) {
          console.log('[SocketService] Cleaning up hostedProjectDeleted listener');
          this.socket!.off('hostedProjectDeleted', handler);
        }
      };
    });
  }
  // ==========================================================================
  // Phase 6b: Granular realtime collaboration (element:* / cursor / presence).
  // These are ADDITIVE. The whole-project save/load path above is untouched and
  // remains the durable persistence/fallback path.
  // ==========================================================================

  /**
   * Join a project's collaboration room. The ack returns the current presence
   * list `{ users: [{ username }] }`.
   */
  joinProjectRoom(projectName: string, projectType: 'local' | 'hosted'): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }
      this.socket!.emit('joinProjectRoom', { projectName, projectType }, (ack: any) => {
        observer.next(ack);
        observer.complete();
      });
    });
  }

  /** Leave a project's collaboration room. */
  leaveProjectRoom(projectName: string, projectType: 'local' | 'hosted'): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('leaveProjectRoom', { projectName, projectType });
  }

  // --- Emit local element ops -------------------------------------------------

  /**
   * Create an element granularly. The server persists ONE row and acks
   * `{ success, gridId, element }` where `element` carries the authoritative
   * stable id — the caller needs that id so the element's later move/edit/delete
   * ops can sync. Returns an Observable that emits the ack (or null during SSR).
   */
  emitElementCreate(
    projectName: string,
    projectType: 'local' | 'hosted',
    gridId: string,
    element: any,
    opId?: string
  ): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.next(null);
        observer.complete();
        return;
      }
      this.socket!.emit('element:create', { projectName, projectType, gridId, element, opId }, (ack: any) => {
        observer.next(ack);
        observer.complete();
      });
    });
  }

  emitElementMove(
    projectName: string,
    projectType: 'local' | 'hosted',
    elementId: string,
    x_pos: number,
    y_pos: number,
    x_scale: number,
    y_scale: number
  ): void {
    if (!this.isSocketAvailable()) return;
    // E10: moves are ephemeral, last-write-wins absolute transforms. Send them
    // volatile so intermediate frames emitted while the transport is briefly
    // unwritable are DROPPED rather than buffered and replayed stale on
    // reconnect — CollabService replays the final per-element transform instead.
    this.socket!.volatile.emit('element:move', { projectName, projectType, elementId, x_pos, y_pos, x_scale, y_scale });
  }

  emitElementUpdateContent(projectName: string, projectType: 'local' | 'hosted', elementId: string, content: any): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('element:update', { projectName, projectType, elementId, content });
  }

  emitElementDelete(projectName: string, projectType: 'local' | 'hosted', elementId: string): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('element:delete', { projectName, projectType, elementId });
  }

  emitCursorMove(projectName: string, projectType: 'local' | 'hosted', x: number, y: number): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('cursor:move', { projectName, projectType, x, y });
  }

  // --- B3: collaborative text (Yjs) ------------------------------------------

  /**
   * Request the authoritative Y.Doc state for a Text_document element. `stateVector`
   * (base64) lets the server reply with only the diff. Acks
   * `{ success, elementId, update, stateVector }` (all base64) or null during SSR.
   */
  emitYdocSync(
    projectName: string,
    projectType: 'local' | 'hosted',
    elementId: string,
    stateVector?: string
  ): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.next(null);
        observer.complete();
        return;
      }
      this.socket!.emit(
        'ydoc:sync',
        { projectName, projectType, elementId, stateVector },
        (ack: any) => {
          observer.next(ack);
          observer.complete();
        }
      );
    });
  }

  /** Send a base64 Yjs update for an element (applied + persisted + relayed server-side). */
  emitYdocUpdate(
    projectName: string,
    projectType: 'local' | 'hosted',
    elementId: string,
    update: string
  ): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('ydoc:update', { projectName, projectType, elementId, update });
  }

  /** Send a base64 Yjs awareness update (remote cursors). Fire-and-forget. */
  emitYdocAwareness(
    projectName: string,
    projectType: 'local' | 'hosted',
    elementId: string,
    update: string
  ): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('ydoc:awareness', { projectName, projectType, elementId, update });
  }

  // --- Listen for remote element ops -----------------------------------------

  private onEvent(eventName: string): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.complete();
        return;
      }
      // Runtime boundary: if this event has a registered schema, validate the
      // (untrusted, peer-originated) payload and drop it on mismatch instead of
      // forwarding malformed data into component state. Unregistered events pass
      // through unchanged.
      const schema = INBOUND_SCHEMAS[eventName];
      const handler = (data: any) => {
        if (schema) {
          const result = validate(schema, data, eventName);
          if (!result.ok) return;
          observer.next(result.data);
          return;
        }
        observer.next(data);
      };
      this.socket!.on(eventName, handler);
      return () => {
        if (this.isSocketAvailable()) {
          this.socket!.off(eventName, handler);
        }
      };
    });
  }

  /** `{ gridId, element }` — a remote peer created an element. */
  onElementCreated(): Observable<any> { return this.onEvent('element:created'); }
  /** `{ elementId, x_pos, y_pos, x_scale, y_scale }` — remote move/resize. */
  onElementMoved(): Observable<any> { return this.onEvent('element:moved'); }
  /** `{ elementId, content }` — remote content patch (JSONB merge). */
  onElementUpdated(): Observable<any> { return this.onEvent('element:updated'); }
  /** `{ elementId }` — remote delete. */
  onElementDeleted(): Observable<any> { return this.onEvent('element:deleted'); }
  /** `{ room, users: [{ username }] }`. */
  onPresenceUpdate(): Observable<any> { return this.onEvent('presence:update'); }
  /** `{ username, x, y }` — remote cursor position. */
  onCursorMoved(): Observable<any> { return this.onEvent('cursor:moved'); }
  /** `{ elementId, update }` — a remote peer's Yjs document update (base64). */
  onYdocUpdated(): Observable<any> { return this.onEvent('ydoc:updated'); }
  /** `{ elementId, update }` — a remote peer's Yjs awareness update (base64). */
  onYdocAwareness(): Observable<any> { return this.onEvent('ydoc:awareness:updated'); }

  // --- A3: task comments (ack-based add/list + broadcast) --------------------

  /**
   * Add a comment to a task. Resolves with the backend ack
   * `{ success: true, comment }` or `{ success: false, message }`.
   */
  emitTaskCommentAdd(
    projectName: string,
    projectType: 'local' | 'hosted',
    taskId: string,
    body: string
  ): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }
      const timeout = setTimeout(() => {
        observer.error(new Error('Add comment timeout'));
        observer.complete();
      }, 10000);
      this.socket!.emit('task:comment:add', { projectName, projectType, taskId, body }, (ack: any) => {
        clearTimeout(timeout);
        observer.next(ack);
        observer.complete();
      });
    });
  }

  /**
   * List comments for a task (oldest-first). Resolves with the backend ack
   * `{ success: true, comments }` or `{ success: false, message }`.
   */
  emitTaskCommentList(
    projectName: string,
    projectType: 'local' | 'hosted',
    taskId: string
  ): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }
      const timeout = setTimeout(() => {
        observer.error(new Error('List comments timeout'));
        observer.complete();
      }, 10000);
      this.socket!.emit('task:comment:list', { projectName, projectType, taskId }, (ack: any) => {
        clearTimeout(timeout);
        observer.next(ack);
        observer.complete();
      });
    });
  }

  /** `{ comment }` — a comment was added (broadcast to the whole room). */
  onTaskCommentAdded(): Observable<any> { return this.onEvent('task:comment:added'); }

  /**
   * N7: `{ taskId, author, body, created_at }` — someone @mentioned the current
   * user in a comment. Delivered to the user's personal room (transient push).
   */
  onMentionNotified(): Observable<any> { return this.onEvent('mention:notified'); }

  // --- E6: element comments (canvas comment pins) ----------------------------
  // Ack-based create/list/resolve/delete + room broadcasts. projectName/type
  // scope the room; `author`/`resolved_by` are derived server-side.

  /** Pin a comment to an element. Ack `{ success, comment }`. */
  emitCommentCreate(
    projectName: string,
    projectType: 'local' | 'hosted',
    elementId: string,
    body: string
  ): Observable<any> {
    return this.ackEmit('comment:create', { projectName, projectType, elementId, body }, 'Add comment');
  }

  /** List every comment pin for a project. Ack `{ success, comments }`. */
  emitCommentList(projectName: string, projectType: 'local' | 'hosted'): Observable<any> {
    return this.ackEmit('comment:list', { projectName, projectType }, 'List comments');
  }

  /** Resolve/re-open a comment. Ack `{ success, comment }`. */
  emitCommentResolve(
    projectName: string,
    projectType: 'local' | 'hosted',
    commentId: string,
    resolved: boolean
  ): Observable<any> {
    return this.ackEmit('comment:resolve', { projectName, projectType, commentId, resolved }, 'Resolve comment');
  }

  /** Delete a comment. Ack `{ success, commentId }`. */
  emitCommentDelete(
    projectName: string,
    projectType: 'local' | 'hosted',
    commentId: string
  ): Observable<any> {
    return this.ackEmit('comment:delete', { projectName, projectType, commentId }, 'Delete comment');
  }

  /** `{ comment }` — a comment was created (broadcast to the whole room). */
  onCommentCreated(): Observable<any> { return this.onEvent('comment:created'); }
  /** `{ comment }` — a comment was resolved/re-opened. */
  onCommentResolved(): Observable<any> { return this.onEvent('comment:resolved'); }
  /** `{ commentId, elementId }` — a comment was deleted. */
  onCommentDeleted(): Observable<any> { return this.onEvent('comment:deleted'); }

  // --- E8: canvas version history / restore (ack-based) ----------------------
  // Whole-canvas snapshots. projectName/type scope the room + authorization;
  // `createdBy` is derived server-side. All three require edit access.

  /** Save a named manual checkpoint of the current canvas. Ack `{ success, snapshot }`. */
  emitSnapshotCreate(
    projectName: string,
    projectType: 'local' | 'hosted',
    label?: string
  ): Observable<any> {
    return this.ackEmit('snapshot:create', { projectName, projectType, label }, 'Save version');
  }

  /** List the project's version timeline (metadata only). Ack `{ success, snapshots }`. */
  emitSnapshotList(projectName: string, projectType: 'local' | 'hosted'): Observable<any> {
    return this.ackEmit('snapshot:list', { projectName, projectType }, 'Load versions');
  }

  /** Restore the canvas to a stored version. Ack `{ success, snapshotId }`. */
  emitSnapshotRestore(
    projectName: string,
    projectType: 'local' | 'hosted',
    snapshotId: string
  ): Observable<any> {
    return this.ackEmit('snapshot:restore', { projectName, projectType, snapshotId }, 'Restore version');
  }

  /** `{ snapshot }` — a new version was saved (broadcast to the whole room). */
  onSnapshotCreated(): Observable<any> { return this.onEvent('snapshot:created'); }
  /** `{ projectName, projectType, snapshotId, restoredBy }` — the canvas was restored; peers should reload. */
  onSnapshotRestored(): Observable<any> { return this.onEvent('snapshot:restored'); }

  // --- N1: sharing / access control (ack-based) ------------------------------

  /** DRY helper for an ack-based emit that resolves with the backend response. */
  private ackEmit(event: string, payload: any, label: string): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }
      const timeout = setTimeout(() => {
        observer.error(new Error(`${label} timeout`));
        observer.complete();
      }, 10000);
      this.socket!.emit(event, payload, (ack: any) => {
        clearTimeout(timeout);
        observer.next(ack);
        observer.complete();
      });
    });
  }

  /** Read members + pending invitations + link config for a project. */
  sharingGet(projectName: string, projectType: 'local' | 'hosted'): Observable<any> {
    return this.ackEmit('sharing:get', { projectName, projectType }, 'Load sharing');
  }
  /** Invite an email at a role ('viewer'|'editor'|'admin'). */
  sharingInvite(projectName: string, projectType: 'local' | 'hosted', email: string, role: string): Observable<any> {
    return this.ackEmit('sharing:invite', { projectName, projectType, email, role }, 'Invite');
  }
  /** Change a collaborator's role. */
  sharingUpdateRole(projectName: string, projectType: 'local' | 'hosted', userId: string, role: string): Observable<any> {
    return this.ackEmit('sharing:updateRole', { projectName, projectType, userId, role }, 'Update role');
  }
  /** Revoke a collaborator's access. */
  sharingRemoveMember(projectName: string, projectType: 'local' | 'hosted', userId: string): Observable<any> {
    return this.ackEmit('sharing:removeMember', { projectName, projectType, userId }, 'Remove member');
  }
  /** Cancel a pending email invitation. */
  sharingRevokeInvite(projectName: string, projectType: 'local' | 'hosted', email: string): Observable<any> {
    return this.ackEmit('sharing:revokeInvite', { projectName, projectType, email }, 'Revoke invite');
  }
  /** Set "anyone with the link" access ('none'|'viewer'|'editor'). */
  sharingSetLink(projectName: string, projectType: 'local' | 'hosted', role: string): Observable<any> {
    return this.ackEmit('sharing:setLink', { projectName, projectType, role }, 'Set link');
  }
  /** `{ projectName, projectType, members, invitations, link }` — state changed. */
  onSharingUpdated(): Observable<any> { return this.onEvent('sharing:updated'); }
  /** `{ projectName, projectType, role, by }` — you were added to a project. */
  onProjectShared(): Observable<any> { return this.onEvent('project:shared'); }

  // --- N2: notification center + activity feed (ack-based) -------------------

  /** The caller's inbox (newest first) + unread count. */
  notificationList(limit?: number): Observable<any> {
    return this.ackEmit('notification:list', { limit }, 'Load notifications');
  }
  /** Just the unread count (cheap poll used on connect). */
  notificationUnreadCount(): Observable<any> {
    return this.ackEmit('notification:unreadCount', {}, 'Unread count');
  }
  /** Mark one notification read; resolves with the fresh unread count. */
  notificationMarkRead(id: string): Observable<any> {
    return this.ackEmit('notification:markRead', { id }, 'Mark read');
  }
  /** Mark every notification read; resolves with unreadCount = 0. */
  notificationMarkAllRead(): Observable<any> {
    return this.ackEmit('notification:markAllRead', {}, 'Mark all read');
  }
  /** A project's activity feed (comments + members added). Needs view access. */
  notificationFeed(projectName: string, projectType: 'local' | 'hosted', limit?: number): Observable<any> {
    return this.ackEmit('notification:feed', { projectName, projectType, limit }, 'Load activity');
  }
  /** `{ id, type, title, body, ... }` — a new notification arrived for the current user. */
  onNotificationNew(): Observable<any> { return this.onEvent('notification:new'); }

  // --- Chat: project channels + 1:1 DMs (ack-based + broadcasts) -------------
  //
  // A conversation is addressed by a `target`: a project channel
  // ({ scope:'project', projectName, projectType }) or a DM
  // ({ scope:'dm', to }). The Angular ChatService builds these; this layer just
  // forwards them and surfaces the acks/broadcasts as Observables.

  /** Post a message. Resolves `{ success, message }`. */
  chatSend(payload: any): Observable<any> {
    return this.ackEmit('chat:send', payload, 'Send message');
  }
  /** Page a conversation oldest-first. Resolves `{ success, messages }`. */
  chatHistory(payload: any): Observable<any> {
    return this.ackEmit('chat:history', payload, 'Load messages');
  }
  /** Edit your own message. Resolves `{ success, message }`. */
  chatEdit(payload: any): Observable<any> {
    return this.ackEmit('chat:edit', payload, 'Edit message');
  }
  /** Delete your own message. Resolves `{ success, id }`. */
  chatDelete(payload: any): Observable<any> {
    return this.ackEmit('chat:delete', payload, 'Delete message');
  }
  /** Toggle an emoji reaction on a message. Resolves `{ success, id, reactions }`. */
  chatReact(payload: any): Observable<any> {
    return this.ackEmit('chat:react', payload, 'React to message');
  }
  /** Mint a shared call link + post it to the conversation. Resolves `{ success, link, provider }`. */
  chatStartCall(payload: any): Observable<any> {
    return this.ackEmit('chat:call:start', payload, 'Start call');
  }
  /** Mark a conversation read up to now. Resolves `{ success }`. */
  chatRead(payload: any): Observable<any> {
    return this.ackEmit('chat:read', payload, 'Mark read');
  }
  /** Unread count for one project channel. Resolves `{ success, count }`. */
  chatUnread(projectName: string, projectType: 'local' | 'hosted'): Observable<any> {
    return this.ackEmit('chat:unread', { projectName, projectType }, 'Unread count');
  }
  /** The caller's DM conversations. Resolves `{ success, conversations }`. */
  chatConversations(): Observable<any> {
    return this.ackEmit('chat:conversations', {}, 'Load conversations');
  }
  /** Typing indicator (fire-and-forget). */
  chatTyping(payload: any): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('chat:typing', payload);
  }

  /** `{ message }` — a message was posted to a conversation you're in. */
  onChatMessage(): Observable<any> { return this.onEvent('chat:message'); }
  /** `{ message }` — a message was edited. */
  onChatMessageUpdated(): Observable<any> { return this.onEvent('chat:message:updated'); }
  /** `{ id }` — a message was deleted. */
  onChatMessageDeleted(): Observable<any> { return this.onEvent('chat:message:deleted'); }
  /** `{ id, reactions }` — a message's reactions changed. */
  onChatMessageReacted(): Observable<any> { return this.onEvent('chat:message:reacted'); }
  /** `{ scope, from, conversationKey }` — someone is typing. */
  onChatTyping(): Observable<any> { return this.onEvent('chat:typing'); }

   /**
   * Import Google Contacts for a user
   * @param username Username to import contacts for
   * @returns Observable that emits the import result
   */
  importGoogleContacts(username: string): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }
      
      console.log('[SocketService] Importing Google Contacts for:', username);
      
      const timeout = setTimeout(() => {
        console.error('[SocketService] Import contacts timeout');
        observer.error(new Error('Import contacts timeout'));
        observer.complete();
      }, 30000); // 30 second timeout for contact import
      
      this.socket!.once('contactsImported', (response: any) => {
        console.log('[SocketService] Received contactsImported response:', response);
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });
         
      this.socket!.emit('importGoogleContacts', { username });
      console.log('[SocketService] Emitted importGoogleContacts event');
    });
  }
}




