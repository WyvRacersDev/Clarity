import { Component, OnInit, OnDestroy, ChangeDetectorRef, PLATFORM_ID, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { DataService } from '../../../services/data.service';
import { SocketService } from '../../../services/socket.service';
import { CollabService, PresenceUser, TaskComment } from '../../../services/collab.service';
import { getServerConfig } from '../../../config/server.config';
import { User } from '../../../../../../shared_models/models/user.model';
import { Project, Grid } from '../../../../../../shared_models/models/project.model';
import { Screen_Element, ToDoLst, Text_document, Image, Video, scheduled_task, objects_builder } from '../../../../../../shared_models/models/screen-elements.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './project-detail.component.html',
  styleUrls: ['./project-detail.component.css']
})
export class ProjectDetailComponent implements OnInit, OnDestroy {
  // Make Math available in template
  Math = Math;

  // Comparison function for ngValue in select elements
  comparePriority = (o1: any, o2: any) => {
    return o1 === o2;
  };

  currentUser: User | null = null;
  project: Project | null = null;
  projectIndex: number = -1;
  selectedGridIndex: number = 0;
  showCreateGridModal = false;
  newGridName = '';
  
  // Error/Alert modal
  showErrorModal = false;
  errorMessage = '';
  
  // Confirmation modal
  showConfirmModal = false;
  confirmMessage = '';
  gridToDelete: { index: number; grid: Grid } | null = null;
  elementToDelete: { index: number; element: Screen_Element } | null = null;
  showAddElementModal = false;
  newElementType: 'ToDoLst' | 'Image' | 'Video' | 'Text_document' = 'ToDoLst';
  showAddTaskModal = false;
  newTaskName = '';
  newTaskPriority: number | null = null; // Changed to null to require selection
  newTaskTime = '';
  taskColumnIndex = -1;
  taskElementIndex = -1;
  private lastSaveTimestamp = 0; // Track when we last saved to prevent reload loop
  showAddTextModal = false;
  newTextDocumentName = '';
  newTextDocumentContent = '';
  isEditingText = false;
  editingTextIndex = -1;
  editingTextContent = '';
  
  // Image/Video name prompts
  showImageNameModal = false;
  showVideoNameModal = false;
  newImageName = '';
  newVideoName = '';
  pendingImageFile: File | null = null;
  pendingVideoFile: File | null = null;

  // Full-screen todo list view
  showFullScreenTodo = false;
  fullScreenTodoElement: ToDoLst | null = null;
  fullScreenTodoElementIndex = -1;
  fullScreenTodoGridIndex = -1;
  showCompletedTasks = true;

  // Tag editing
  editingTagInput: string = '';
  selectedTodoForTagEdit: any = null;

  // Element selection and editing
  selectedElementIndex = -1;
  editingElementIndex = -1;
  editingElementName = '';
  editingElementNameIndex = -1;
  editingElementNameGridIndex = -1;

  // Canvas dragging
  draggedElement: HTMLElement | null = null;
  draggedElementIndex: number = -1;
  draggedElementGridIndex: number = -1;
  elementDragOffsetX: number = 0;
  elementDragOffsetY: number = 0;
  isDraggingEnabled: boolean = false;
  longPressTimer: any = null;
  longPressTargetIndex: number = -1;
  justFinishedDragging: boolean = false;
  isResizing: boolean = false;
  resizeHandle: string = '';
  resizingElement: Screen_Element | null = null;
  resizingElementIndex: number = -1;
  resizingElementGridIndex: number = -1;
  startResizeX: number = 0;
  startResizeY: number = 0;
  startWidth: number = 0;
  startHeight: number = 0;

  // New element on canvas
  showElementTypeSelector = false;
  fileInput: HTMLInputElement | null = null;

  // Canvas properties
  canvasZoom: number = 1;
  canvasPanX: number = 0;
  canvasPanY: number = 0;
  isPanning: boolean = false;
  panStartX: number = 0;
  panStartY: number = 0;
  showGrid: boolean = true;

  // Loading states
  isSaving = false;
  isLoading = false;
  private savingTimeout: any = null;
  private loadingTimeout: any = null;

  // Subscriptions
  private hostedProjectUpdateSubscription: any;
  private hostedProjectDeleteSubscription: any;
  private elementUpdateSubscription: any;

  // ---- Phase 6b: granular realtime collaboration state ----
  // Presence: usernames currently in the room.
  presenceUsers: PresenceUser[] = [];
  // Remote cursors keyed by username; cleaned up when a user leaves the room.
  remoteCursors: Map<string, { x: number; y: number }> = new Map();
  // Set of element ids we are currently applying a REMOTE op to, so applying
  // a remote change never re-emits it back out (self-echo guard).
  private applyingRemoteIds: Set<string> = new Set();
  // Which project (name/type) we joined a collab room for.
  private joinedRoomKey: string | null = null;
  private collabSubscriptions: Subscription[] = [];
  private lastCursorEmit = 0;
  private lastMoveEmit = 0;

  // ---- A2: dependency links on the canvas ----
  /** When set, we're in "pick a target ToDoLst" mode; value is the source element id. */
  linkSourceId: string | null = null;

  // ---- A3: task comments panel (in the fullscreen todo overlay) ----
  /** The task whose comments panel is open, or null. */
  selectedCommentTask: scheduled_task | null = null;
  /** Comments for the selected task, oldest-first. */
  taskComments: TaskComment[] = [];
  newCommentBody = '';
  isLoadingComments = false;
  /** Per-task comment counts, keyed by task id. */
  private commentCounts: Map<string, number> = new Map();

  constructor(
    private dataService: DataService,
    private socketService: SocketService,
    private collabService: CollabService,
    private route: ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      this.projectIndex = +params['id'];
      this.loadProject();
    });

    this.dataService.currentUser$.subscribe((user: User | null) => {
      this.currentUser = user;
      this.loadProject();
    });

    // Subscribe to loading states
    this.dataService.savingProject$.subscribe(loading => {
      this.isSaving = loading;
      console.log('Project detail - Saving state changed:', loading);
      
      // Clear any existing timeout
      if (this.savingTimeout) {
        clearTimeout(this.savingTimeout);
        this.savingTimeout = null;
      }
      
      // Safety timeout: force clear saving state after 15 seconds
      if (loading) {
        this.savingTimeout = setTimeout(() => {
          if (this.isSaving) {
            console.warn('[ProjectDetail] Force clearing stuck saving state after timeout');
            this.isSaving = false;
            this.cdr.detectChanges();
          }
          this.savingTimeout = null;
        }, 15000);
      }
      
      this.cdr.detectChanges();
    });

    this.dataService.loadingProject$.subscribe(loading => {
      this.isLoading = loading;
      
      // Clear any existing timeout
      if (this.loadingTimeout) {
        clearTimeout(this.loadingTimeout);
        this.loadingTimeout = null;
      }
      
      // Safety timeout: force clear loading state after 15 seconds
      if (loading) {
        this.loadingTimeout = setTimeout(() => {
          if (this.isLoading) {
            console.warn('[ProjectDetail] Force clearing stuck loading state after timeout');
            this.isLoading = false;
            this.cdr.detectChanges();
          }
          this.loadingTimeout = null;
        }, 15000);
      }
      
      this.cdr.detectChanges();
    });

    // Listen for real-time updates
    this.elementUpdateSubscription = this.socketService.onElementUpdate().subscribe((data: any) => {
      if (this.project && data.projectId === this.project.name) {
        this.loadProject();
      }
    });

    // Listen for hosted project updates (broadcasted to all clients)
    this.hostedProjectUpdateSubscription = this.socketService.onHostedProjectUpdated().subscribe((data: any) => {
      console.log('[ProjectDetail] Received hostedProjectUpdated event:', data);
      if (this.project) {
        console.log(`[ProjectDetail] Current project: name="${this.project.name}", type="${(this.project as any).projectType}"`);
        if ((this.project as any).projectType === 'hosted' &&
          data.projectName === this.project.name) {
          
          // Check if we just saved (within last 2 seconds) - if so, skip reload to avoid interrupting user
          const timeSinceLastSave = Date.now() - this.lastSaveTimestamp;
          if (timeSinceLastSave < 2000) {
            console.log(`[ProjectDetail] ℹ️ Skipping reload - we just saved ${timeSinceLastSave}ms ago`);
            return;
          }
          
          console.log('[ProjectDetail] ✓ Hosted project updated by another user, reloading from server...');
          this.reloadProjectFromServer();
        } else {
          console.log('[ProjectDetail] ✗ Update ignored - project type mismatch or name mismatch');
        }
      } else {
        console.log('[ProjectDetail] ✗ Update ignored - no current project');
      }
    });

    // Listen for hosted project deletions
    this.hostedProjectDeleteSubscription = this.socketService.onHostedProjectDeleted().subscribe((data: any) => {
      console.log('[ProjectDetail] Received hostedProjectDeleted event:', data);
      if (this.project &&
        (this.project as any).projectType === 'hosted' &&
        data.projectName === this.project.name) {
        console.log('[ProjectDetail] Hosted project deleted by another user');
        alert('This project has been deleted by another user.');
        this.router.navigate(['/dashboard/projects']);
      }
    });

    // Global mouse move and up listeners for drag (only in browser)
    if (isPlatformBrowser(this.platformId)) {
      document.addEventListener('mousemove', (e) => this.onDocumentMouseMove(e));
      document.addEventListener('mouseup', (e) => this.onDocumentMouseUp(e));
      document.addEventListener('mousedown', (e) => this.onDocumentMouseDown(e));
      
      //TOUCH CONTROLS KIS NEI ADD KERNE THAY?????
      document.addEventListener('touchmove', (e) => this.onDocumentTouchMove(e), { passive: false });
      document.addEventListener('touchend', (e) => this.onDocumentTouchEnd(e));
      document.addEventListener('touchstart', (e) => this.onDocumentTouchStart(e));
    }
  }

  loadProject(): void {
    if (this.currentUser && this.projectIndex >= 0 && this.currentUser.projects[this.projectIndex]) {
      this.project = this.currentUser.projects[this.projectIndex];
      // CRITICAL: Ensure projectType is set and never lost
      if (!(this.project as any).projectType) {
        console.error(`[ProjectDetail] Project ${this.project.name} missing projectType! This should never happen.`);
        (this.project as any).projectType = 'local'; // Fallback, but log error
      }
      if (this.project.grid.length > 0 && this.selectedGridIndex >= this.project.grid.length) {
        this.selectedGridIndex = 0;
      }
      // Phase 6b: join the granular collaboration room for this project (once).
      this.ensureCollabRoom();
    }
  }

  /**
   * Phase 6b: Join the granular realtime room for the current project and wire
   * remote op streams. Re-joins only when the target project changes. Additive:
   * failures here never affect the existing whole-project save/load flow.
   */
  private async ensureCollabRoom(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !this.project) return;
    const projectType = (this.project as any).projectType || this.project.project_type;
    if (!projectType) return;

    const roomKey = `${projectType}:${this.project.name}`;
    if (this.joinedRoomKey === roomKey) return; // already in this room

    // Leaving a previous room (project switch within the same component instance).
    if (this.joinedRoomKey) {
      this.collabService.leaveRoom();
      this.teardownCollabStreams();
    }

    this.joinedRoomKey = roomKey;
    this.wireCollabStreams();

    try {
      const users = await this.collabService.joinRoom(this.project.name, projectType);
      this.presenceUsers = users;
      this.cdr.detectChanges();
    } catch (e) {
      console.warn('[ProjectDetail] joinProjectRoom failed (collab disabled):', e);
    }
  }

  private teardownCollabStreams(): void {
    this.collabSubscriptions.forEach(s => s.unsubscribe());
    this.collabSubscriptions = [];
    this.remoteCursors.clear();
  }

  /** Subscribe to remote element ops / presence / cursors and apply them. */
  private wireCollabStreams(): void {
    this.collabSubscriptions.push(
      this.collabService.onRemoteCreated().subscribe(data => this.applyRemoteCreated(data)),
      this.collabService.onRemoteMoved().subscribe(data => this.applyRemoteMoved(data)),
      this.collabService.onRemoteUpdated().subscribe(data => this.applyRemoteUpdated(data)),
      this.collabService.onRemoteDeleted().subscribe(data => this.applyRemoteDeleted(data)),
      this.collabService.onPresence().subscribe(users => {
        this.presenceUsers = users;
        // Drop cursors for users no longer present.
        const present = new Set(users.map(u => u.username));
        for (const name of Array.from(this.remoteCursors.keys())) {
          if (!present.has(name)) this.remoteCursors.delete(name);
        }
        this.cdr.detectChanges();
      }),
      this.collabService.onRemoteCursor().subscribe(c => {
        if (c && c.username) {
          this.remoteCursors.set(c.username, { x: c.x, y: c.y });
          this.cdr.detectChanges();
        }
      }),
      // A3: live task comments — bump counts and append to the open panel.
      this.collabService.onCommentAdded().subscribe(comment => this.applyRemoteComment(comment))
    );
  }

  // ---- Helpers to locate elements by stable id across grids ----

  /** Find an element (and its grid) by its stable id. */
  private findElementById(elementId: string): { element: Screen_Element; gridIndex: number; elementIndex: number } | null {
    if (!this.project || !elementId) return null;
    for (let g = 0; g < this.project.grid.length; g++) {
      const els = this.project.grid[g].Screen_elements;
      for (let i = 0; i < els.length; i++) {
        if ((els[i] as any).id === elementId) {
          return { element: els[i], gridIndex: g, elementIndex: i };
        }
      }
    }
    return null;
  }

  /** Find the grid index that contains a given element instance. */
  private findGridIndexOfElement(element: Screen_Element): number {
    if (!this.project) return this.selectedGridIndex;
    for (let g = 0; g < this.project.grid.length; g++) {
      if (this.project.grid[g].Screen_elements.includes(element)) return g;
    }
    return this.selectedGridIndex;
  }

  private isApplyingRemote(id: string | undefined): boolean {
    return !!id && this.applyingRemoteIds.has(id);
  }

  // ---- Apply incoming remote ops to the local model ----

  private applyRemoteCreated(data: { gridId: string; element: any }): void {
    if (!this.project || !data?.element) return;
    const rebuilt = objects_builder.rebuild(data.element) as Screen_Element;
    if (!rebuilt || !(rebuilt instanceof Screen_Element)) return;
    // Ensure id carried through.
    if (data.element.id && !(rebuilt as any).id) (rebuilt as any).id = data.element.id;

    // Skip if we already have this element (id already present).
    if ((rebuilt as any).id && this.findElementById((rebuilt as any).id)) return;

    // Locate the target grid by id; fall back to grid[0].
    let gridIndex = this.project.grid.findIndex(g => (g as any).id === data.gridId);
    if (gridIndex < 0) gridIndex = 0;
    if (!this.project.grid[gridIndex]) return;

    this.project.grid[gridIndex].Screen_elements.push(rebuilt);
    this.dataService.updateCurrentUser();
    this.cdr.detectChanges();
  }

  private applyRemoteMoved(data: { elementId: string; x_pos: number; y_pos: number; x_scale: number; y_scale: number }): void {
    const found = this.findElementById(data?.elementId);
    if (!found) return;
    const el = found.element as any;
    this.applyingRemoteIds.add(data.elementId);
    try {
      el.x_pos = data.x_pos;
      el.y_pos = data.y_pos;
      if (data.x_scale !== undefined && data.x_scale !== null) el.x_scale = data.x_scale;
      if (data.y_scale !== undefined && data.y_scale !== null) el.y_scale = data.y_scale;
      this.dataService.updateCurrentUser();
      this.cdr.detectChanges();
    } finally {
      this.applyingRemoteIds.delete(data.elementId);
    }
  }

  private applyRemoteUpdated(data: { elementId: string; content: any }): void {
    const found = this.findElementById(data?.elementId);
    if (!found || !data?.content) return;
    const el = found.element as any;
    this.applyingRemoteIds.add(data.elementId);
    try {
      // content is a JSONB merge patch — apply known fields.
      Object.keys(data.content).forEach(key => {
        el[key] = data.content[key];
      });
      this.dataService.updateCurrentUser();
      this.cdr.detectChanges();
    } finally {
      this.applyingRemoteIds.delete(data.elementId);
    }
  }

  private applyRemoteDeleted(data: { elementId: string }): void {
    const found = this.findElementById(data?.elementId);
    if (!found || !this.project) return;
    this.applyingRemoteIds.add(data.elementId);
    try {
      this.project.grid[found.gridIndex].Screen_elements.splice(found.elementIndex, 1);
      this.dataService.updateCurrentUser();
      this.cdr.detectChanges();
    } finally {
      this.applyingRemoteIds.delete(data.elementId);
    }
  }

  // ---- Emit local ops (throttled where noted) ----

  /** Emit a granular move/resize for an element. No-op if id missing. */
  private emitElementMove(element: Screen_Element, throttle = true): void {
    const id = (element as any).id as string | undefined;
    if (!id || this.isApplyingRemote(id)) return; // missing id -> rely on whole-project save
    if (throttle) {
      const now = Date.now();
      if (now - this.lastMoveEmit < 50) return;
      this.lastMoveEmit = now;
    }
    const e = element as any;
    this.collabService.emitMove(id, e.x_pos ?? 0, e.y_pos ?? 0, e.x_scale ?? 1, e.y_scale ?? 1);
  }

  /** Emit a granular content patch (e.g. Text_field) for an element. */
  private emitElementContent(element: Screen_Element, content: any): void {
    const id = (element as any).id as string | undefined;
    if (!id || this.isApplyingRemote(id)) return;
    this.collabService.emitContentUpdate(id, content);
  }

  /** Emit a granular delete for an element. */
  private emitElementDelete(element: Screen_Element): void {
    const id = (element as any).id as string | undefined;
    if (!id) return;
    this.collabService.emitDelete(id);
  }

  /**
   * Emit a granular create for a freshly-added element. If the element already
   * has an id (server round-tripped), use it; otherwise still emit so peers can
   * add it (the backend assigns/returns an authoritative id via element:created).
   */
  private emitElementCreate(element: Screen_Element, gridIndex: number): void {
    if (!this.project || !this.project.grid[gridIndex]) return;
    const gridId = (this.project.grid[gridIndex] as any).id as string | undefined;
    if (!gridId) return; // no grid id -> rely on whole-project save
    this.collabService.emitCreate(gridId, (element as any).toJSON ? (element as any).toJSON() : element);
  }

  /**
   * Emit the local cursor position (throttled ~50ms) in canvas-content
   * coordinates. No-op when the pointer isn't over the canvas or no room joined.
   */
  private emitCursor(event: MouseEvent): void {
    if (!isPlatformBrowser(this.platformId) || !this.collabService.isJoined) return;
    const now = Date.now();
    if (now - this.lastCursorEmit < 50) return;

    const container = document.querySelector('.canvas-container') as HTMLElement;
    if (!container) return;
    // Only broadcast when the pointer is actually over the canvas surface.
    if (!(event.target as HTMLElement)?.closest('.canvas-container')) return;

    const rect = container.getBoundingClientRect();
    // Convert to canvas-content space (undo pan/zoom) so peers align.
    const x = (event.clientX - rect.left - this.canvasPanX) / this.canvasZoom;
    const y = (event.clientY - rect.top - this.canvasPanY) / this.canvasZoom;

    this.lastCursorEmit = now;
    this.collabService.emitCursor(x, y);
  }

  goBack(): void {
    this.router.navigate(['/dashboard/projects']);
  }

  // ---- Phase 6b: template helpers for presence + cursor rendering ----

  /** Remote cursors as a renderable array (used by *ngFor / @for). */
  getRemoteCursors(): { username: string; x: number; y: number }[] {
    const out: { username: string; x: number; y: number }[] = [];
    this.remoteCursors.forEach((pos, username) => out.push({ username, x: pos.x, y: pos.y }));
    return out;
  }

  /** Up-to-two-letter initials for a presence avatar. */
  getInitials(username: string): string {
    if (!username) return '?';
    const parts = username.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  async reloadProjectFromServer(): Promise<void> {
    if (!this.project || !this.currentUser) {
      console.warn('[ProjectDetail] Cannot reload: project or user is null');
      return;
    }

    const projectType = (this.project as any).projectType;
    if (!projectType) {
      console.error(`[ProjectDetail] Cannot reload project ${this.project.name} - projectType is missing!`);
      return;
    }

    console.log(`[ProjectDetail] Reloading project "${this.project.name}" from server (type: ${projectType})...`);

    try {
      const reloadedProject = await this.dataService.loadProject(this.project.name, projectType);
      if (reloadedProject) {
        // Find the project in the user's projects array and update it
        const index = this.currentUser.projects.findIndex(p => p.name === this.project!.name);
        if (index !== -1) {
          this.currentUser.projects[index] = reloadedProject;
          this.project = reloadedProject;
          this.projectIndex = index;

          // Ensure selectedGridIndex is still valid
          if (this.project.grid.length > 0 && this.selectedGridIndex >= this.project.grid.length) {
            this.selectedGridIndex = 0;
          }

          console.log(`[ProjectDetail] ✓ Successfully reloaded project "${this.project.name}"`);
          this.cdr.detectChanges();
        } else {
          console.warn(`[ProjectDetail] Project "${this.project.name}" not found in user's projects array`);
        }
      } else {
        console.error(`[ProjectDetail] Failed to reload project "${this.project.name}" from server`);
      }
    } catch (error) {
      console.error(`[ProjectDetail] Error reloading project:`, error);
    }
  }

  openCreateGridModal(): void {
    this.showCreateGridModal = true;
    this.newGridName = '';
  }

  closeCreateGridModal(): void {
    this.showCreateGridModal = false;
    this.newGridName = '';
  }

  showError(message: string): void {
    this.errorMessage = message;
    this.showErrorModal = true;
  }

  closeErrorModal(): void {
    this.showErrorModal = false;
    this.errorMessage = '';
  }

  showConfirmation(message: string, index: number, grid: Grid): void {
    this.confirmMessage = message;
    this.gridToDelete = { index, grid };
    this.showConfirmModal = true;
  }

  closeConfirmModal(): void {
    this.showConfirmModal = false;
    this.confirmMessage = '';
    this.gridToDelete = null;
    this.elementToDelete = null;
  }

  async confirmDeleteGrid(): Promise<void> {
    if (!this.gridToDelete || !this.project) {
      this.closeConfirmModal();
      return;
    }

    const { index } = this.gridToDelete;
    this.closeConfirmModal();

    await this.dataService.deleteGrid(this.projectIndex, index);
    if (this.selectedGridIndex >= this.project.grid.length) {
      this.selectedGridIndex = Math.max(0, this.project.grid.length - 1);
    }
  }

  async confirmDeleteElement(): Promise<void> {
    if (!this.elementToDelete || !this.project) {
      this.closeConfirmModal();
      return;
    }

    const { index } = this.elementToDelete;
    this.closeConfirmModal();

    // Safety timeout to clear loading states if operation takes too long
    const safetyTimeout = setTimeout(() => {
      console.warn('[ProjectDetail] Delete operation timeout - forcing loading states to clear');
      this.isSaving = false;
      this.isLoading = false;
      this.cdr.detectChanges();
    }, 10000); // 10 second timeout

    try {
      // Get element before deletion to check if it's Image/Video
      const element = this.project.grid[this.selectedGridIndex].Screen_elements[index];
      console.log(`[ProjectDetail] Deleting element at index ${index}:`, element);

      // Remove from grid (this will also delete file and save)
      await this.dataService.removeElementFromGrid(this.projectIndex, this.selectedGridIndex, index);

      // Phase 6b: broadcast the granular delete to peers (by stable id).
      if (element) this.emitElementDelete(element);

      // Clear the safety timeout
      clearTimeout(safetyTimeout);

      // Reload to ensure sync with server
      this.loadProject();
      this.cdr.detectChanges();
    } catch (error) {
      console.error('[ProjectDetail] Error deleting element:', error);
      clearTimeout(safetyTimeout);
      this.isSaving = false;
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async createGrid(): Promise<void> {
    if (this.newGridName.trim() && this.projectIndex >= 0) {
      // Store grid name before closing modal
      const gridName = this.newGridName.trim();
      
      // Check if grid with same name already exists in this project (case-sensitive)
      if (this.project) {
        const existingGrid = this.project.grid.find(g => g.name === gridName);
        if (existingGrid) {
          this.showError(`A grid named "${gridName}" already exists in this project. Please choose a different name.`);
          return;
        }
      }
      
      // Close modal immediately
      this.closeCreateGridModal();
      
      await this.dataService.createGrid(this.projectIndex, gridName);
      if (this.project) {
        this.selectedGridIndex = this.project.grid.length - 1;
      }
    }
  }

  async deleteGrid(index: number): Promise<void> {
    if (this.project && this.project.grid[index]) {
      const grid = this.project.grid[index];
      this.showConfirmation(`Are you sure you want to delete the grid "${grid.name}"?`, index, grid);
    }
  }

  openAddElementModal(): void {
    console.log('[ProjectDetail] openAddElementModal called');
    console.log('[ProjectDetail] project:', this.project);
    console.log('[ProjectDetail] grid.length:', this.project?.grid?.length);
    if (!this.project || this.project.grid.length === 0) {
      console.log('[ProjectDetail] Returning early - no project or no grids');
      return;
    }
    console.log('[ProjectDetail] Setting showElementTypeSelector to true');
    this.showElementTypeSelector = true;
    this.cdr.detectChanges(); // Force change detection
  }

  selectElementType(type: 'ToDoLst' | 'Image' | 'Video' | 'Text_document'): void {
    this.newElementType = type;
    this.showElementTypeSelector = false;

    if (type === 'Image') {
      this.triggerImageUpload();
    } else if (type === 'Video') {
      this.triggerVideoUpload();
    } else if (type === 'Text_document') {
      this.openAddTextModal();
    } else if (type === 'ToDoLst') {
      this.createTodoElement();
    }
  }

  async createTodoElement(): Promise<void> {
    if (!this.project || this.selectedGridIndex < 0) {
      console.error('[ProjectDetail] createTodoElement: no project or invalid grid index');
      return;
    }

    try {
      const element = new ToDoLst('Tasks', 20, 20);
      element.x_scale = 280;
      element.y_scale = 200;
      const success = await this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
      if (!success) {
        console.error('[ProjectDetail] createTodoElement: addElementToGrid returned false');
      }
      this.loadProject();
      // Phase 6b: broadcast the granular create to peers.
      this.emitElementCreate(element, this.selectedGridIndex);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('[ProjectDetail] createTodoElement error:', error);
    }
  }

  triggerImageUpload(): void {
    // Reset file input to ensure accept attribute is correct
    if (this.fileInput) {
      this.fileInput.remove();
    }
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*';
    this.fileInput.onchange = () => {
      if (this.fileInput && this.fileInput.files && this.fileInput.files.length > 0) {
        this.pendingImageFile = this.fileInput.files[0];
        this.newImageName = '';
        this.showImageNameModal = true;
      }
    };
    this.fileInput.click();
  }
  
  async confirmImageUpload(): Promise<void> {
    if (!this.pendingImageFile || !this.newImageName.trim()) {
      return;
    }
    
    this.showImageNameModal = false;
    await this.handleImageUpload(this.pendingImageFile, this.newImageName.trim());
    this.pendingImageFile = null;
    this.newImageName = '';
  }
  
  cancelImageUpload(): void {
    this.showImageNameModal = false;
    this.pendingImageFile = null;
    this.newImageName = '';
  }

  triggerVideoUpload(): void {
    // Reset file input to ensure accept attribute is correct
    if (this.fileInput) {
      this.fileInput.remove();
    }
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'video/*';
    this.fileInput.onchange = () => {
      if (this.fileInput && this.fileInput.files && this.fileInput.files.length > 0) {
        this.pendingVideoFile = this.fileInput.files[0];
        this.newVideoName = '';
        this.showVideoNameModal = true;
      }
    };
    this.fileInput.click();
  }
  
  async confirmVideoUpload(): Promise<void> {
    if (!this.pendingVideoFile || !this.newVideoName.trim()) {
      return;
    }
    
    this.showVideoNameModal = false;
    await this.handleVideoUpload(this.pendingVideoFile, this.newVideoName.trim());
    this.pendingVideoFile = null;
    this.newVideoName = '';
  }
  
  cancelVideoUpload(): void {
    this.showVideoNameModal = false;
    this.pendingVideoFile = null;
    this.newVideoName = '';
  }

  async handleImageUpload(file: File, imageName: string): Promise<void> {
    if (!file || !this.project) return;

    const reader = new FileReader();

    reader.onload = async (e: any) => {
      try {
        const imageDataUrl = e.target.result as string;
        const projectType = (this.project as any).projectType || 'local';

        // Upload file to server and get local path
        const uploadResponse = await firstValueFrom(
          this.socketService.uploadFile(this.project!.name, projectType, file.name, imageDataUrl, 'image')
        );

        if (uploadResponse.success && uploadResponse.filePath) {
          // Create element with server file path (server serves from /projects, so path is relative to that)
          const serverUrl = getServerConfig();
          const localPath = `${serverUrl}/projects/${projectType}/${uploadResponse.filePath}`;
          console.log(`[ProjectDetail] Image uploaded, using path: ${localPath}`);
          const element = new Image(localPath, 400, 300, imageName);
          element.set_x_scale(300); // width
          element.set_y_scale(200); // height
          console.log(`[ProjectDetail] Created Image element:`, {
            name: element.name,
            imagepath: element.imagepath,
            toJSON: element.toJSON()
          });
          await this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
          this.socketService.emitElementUpdate(element, this.project!.name, this.project!.grid[this.selectedGridIndex].name);
          this.loadProject(); // Reload to see the changes
          this.emitElementCreate(element, this.selectedGridIndex);
          this.cdr.detectChanges();
        } else {
          console.error('Failed to upload image:', uploadResponse.message);
          alert('Failed to upload image. Please try again.');
        }
      } catch (error) {
        console.error('Error uploading image:', error);
        alert('Error uploading image. Please try again.');
      }
    };

    reader.readAsDataURL(file);
  }

  async handleVideoUpload(file: File, videoName: string): Promise<void> {
    if (!file || !this.project) return;

    const reader = new FileReader();

    reader.onload = async (e: any) => {
      try {
        const videoDataUrl = e.target.result as string;
        const projectType = (this.project as any).projectType || 'local';

        // Upload file to server and get local path
        const uploadResponse = await firstValueFrom(
          this.socketService.uploadFile(this.project!.name, projectType, file.name, videoDataUrl, 'video')
        );

        if (uploadResponse.success && uploadResponse.filePath) {
          // Create element with server file path (server serves from /projects, so path is relative to that)
          const serverUrl = getServerConfig();
          const localPath = `${serverUrl}/projects/${projectType}/${uploadResponse.filePath}`;
          console.log(`[ProjectDetail] Video uploaded, using path: ${localPath}`);
          const element = new Video(localPath, 400, 300, videoName);
          element.set_x_scale(400); // width
          element.set_y_scale(300); // height
          console.log(`[ProjectDetail] Created Video element:`, {
            name: element.name,
            VideoPath: element.VideoPath,
            toJSON: element.toJSON()
          });
          await this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
          this.socketService.emitElementUpdate(element, this.project!.name, this.project!.grid[this.selectedGridIndex].name);
          this.loadProject(); // Reload to see the changes
          this.emitElementCreate(element, this.selectedGridIndex);
          this.cdr.detectChanges();
        } else {
          console.error('Failed to upload video:', uploadResponse.message);
          alert('Failed to upload video. Please try again.');
        }
      } catch (error) {
        console.error('Error uploading video:', error);
        alert('Error uploading video. Please try again.');
      }
    };

    reader.readAsDataURL(file);
  }

  async onTaskToggle(task: any): Promise<void> {
    if (task.get_status()) {
      task.mark_incomplete();
    } else {
      const username = this.currentUser?.name || 'Unknown User';
      task.mark_complete(username);
    }
    this.dataService.updateCurrentUser();
    // Save the project to persist changes
    if (this.project) {
      const projectType = (this.project as any).projectType;
      if (!projectType) {
        console.error(`[ProjectDetail] Cannot save project ${this.project.name} - projectType is missing!`);
        return;
      }
      await this.dataService.saveProject(this.project, projectType);
      this.loadProject(); // Reload to see the changes
      this.cdr.detectChanges();
    }
  }

  startEditingText(element: Screen_Element, gridIndex: number, elementIndex: number): void {
    if (element.constructor.name === 'Text_document') {
      this.isEditingText = true;
      this.editingTextIndex = elementIndex;
      this.editingTextContent = (element as any).get_field() || '';
    }
  }

  async saveTextEdit(): Promise<void> {
    if (!this.project || this.editingTextIndex === -1) return;

    const element = this.project.grid[this.selectedGridIndex].Screen_elements[this.editingTextIndex];
    if (element && element.constructor.name === 'Text_document') {
      (element as any).set_field(this.editingTextContent);
      // Phase 6b: broadcast the granular content patch to peers.
      this.emitElementContent(element, { Text_field: this.editingTextContent });
      this.dataService.updateCurrentUser();
      // Save the project to persist changes
      const projectType = (this.project as any).projectType;
      if (!projectType) {
        console.error(`[ProjectDetail] Cannot save project ${this.project.name} - projectType is missing!`);
        return;
      }
      await this.dataService.saveProject(this.project, projectType);
      this.loadProject(); // Reload to see the changes
      this.cdr.detectChanges();
    }

    this.isEditingText = false;
    this.editingTextIndex = -1;
    this.editingTextContent = '';
  }

  cancelTextEdit(): void {
    this.isEditingText = false;
    this.editingTextIndex = -1;
    this.editingTextContent = '';
  }

  getTextContent(element: Screen_Element): string {
    if (element.constructor.name === 'Text_document') {
      return (element as any).get_field() || '';
    }
    return '';
  }

  openAddTextModal(): void {
    this.showAddTextModal = true;
    this.newTextDocumentName = '';
    this.newTextDocumentContent = '';
  }

  closeAddTextModal(): void {
    this.showAddTextModal = false;
    this.newTextDocumentName = '';
    this.newTextDocumentContent = '';
  }

  async submitAddTextDocument(): Promise<void> {
    if (!this.project || this.selectedGridIndex < 0 || !this.newTextDocumentName.trim()) {
      return;
    }

    // Store values before closing modal
    const documentName = this.newTextDocumentName.trim();
    const documentContent = this.newTextDocumentContent || '';

    // Close modal first to provide immediate feedback
    this.closeAddTextModal();

    const element = new Text_document(
      documentName,
      200,
      200,
      documentContent
    );
    await this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
    this.socketService.emitElementUpdate(element, this.project.name, this.project.grid[this.selectedGridIndex].name);
    this.loadProject(); // Reload to see the changes
    this.emitElementCreate(element, this.selectedGridIndex);
    this.cdr.detectChanges();
  }

  async deleteElement(elementIndex: number): Promise<void> {
    if (this.project && this.selectedGridIndex >= 0 && this.project.grid[this.selectedGridIndex].Screen_elements[elementIndex]) {
      const element = this.project.grid[this.selectedGridIndex].Screen_elements[elementIndex];
      this.elementToDelete = { index: elementIndex, element };
      this.confirmMessage = `Are you sure you want to delete the element "${element.name}"?`;
      this.showConfirmModal = true;
    }
  }

  getElementType(element: Screen_Element): string {
    const typedElement = element as any;
    const explicitType = typedElement?.type;
    if (typeof explicitType === 'string' && explicitType.length > 0) {
      return explicitType;
    }

    const constructorName = typedElement?.constructor?.name;
    if (constructorName && constructorName !== 'Object') {
      return constructorName;
    }

    if (Array.isArray(typedElement?.scheduled_tasks)) {
      return 'ToDoLst';
    }
    if (typedElement?.Text_field !== undefined || typedElement?.text_field !== undefined || typeof typedElement?.get_field === 'function') {
      return 'Text_document';
    }
    if (typedElement?.imagepath !== undefined || typedElement?.imagePath !== undefined || typedElement?.ImageBase64 !== undefined) {
      return 'Image';
    }
    if (typedElement?.VideoPath !== undefined || typedElement?.videoPath !== undefined || typedElement?.videoBase64 !== undefined) {
      return 'Video';
    }

    return 'Screen_Element';
  }

  getTodoTasks(element: Screen_Element): any[] {
    if (this.getElementType(element) === 'ToDoLst') {
      return (element as any).scheduled_tasks || [];
    }
    return [];
  }

  getImagePath(element: Screen_Element): SafeUrl {
    if (this.getElementType(element) === 'Image') {
      const path = (element as any).imagepath || '';
      return this.sanitizer.bypassSecurityTrustUrl(path);
    }
    return this.sanitizer.bypassSecurityTrustUrl('');
  }

  getVideoPath(element: Screen_Element): SafeUrl {
    if (this.getElementType(element) === 'Video') {
      const path = (element as any).VideoPath || '';
      return this.sanitizer.bypassSecurityTrustUrl(path);
    }
    return this.sanitizer.bypassSecurityTrustUrl('');
  }


  addTaskToTodoList(elementIndex: number): void {
    if (!this.project || this.selectedGridIndex < 0) return;

    const element = this.project.grid[this.selectedGridIndex].Screen_elements[elementIndex];
    if (element && this.getElementType(element) === 'ToDoLst') {
      // Set the task column index to the selected grid index and use the element as the todo list
      this.taskColumnIndex = this.selectedGridIndex;
      this.taskElementIndex = elementIndex;
      this.showAddTaskModal = true;
      this.newTaskName = '';
      this.newTaskPriority = 2;
    }
  }

  closeAddTaskModal(): void {
    this.showAddTaskModal = false;
    this.newTaskName = '';
    this.newTaskPriority = null;
    this.taskColumnIndex = -1;
    this.taskElementIndex = -1;
  }

  async submitAddTask(): Promise<void> {
    if (!this.project || this.taskColumnIndex === -1 || !this.newTaskName.trim()) return;

    let todoList: ToDoLst | null = null;

    // If we have a specific element index (from grid view), use that
    if (this.taskElementIndex >= 0 && this.project.grid[this.taskColumnIndex]) {
      const element = this.project.grid[this.taskColumnIndex].Screen_elements[this.taskElementIndex];
      if (element && this.getElementType(element) === 'ToDoLst') {
        todoList = element as ToDoLst;
      }
    }

    // Find the first todo list in the column if no specific element index
    if (!todoList && this.project.grid[this.taskColumnIndex]) {
      const element = this.project.grid[this.taskColumnIndex].Screen_elements.find(
        (el: Screen_Element) => this.getElementType(el) === 'ToDoLst'
      );
      if (element) {
        todoList = element as ToDoLst;
      }
    }

    if (!todoList) {
      // Create new todo list
      todoList = new ToDoLst('Tasks', 0, 0);
      await this.dataService.addElementToGrid(this.projectIndex, this.taskColumnIndex, todoList);
    }

    // Ensure priority is a number (it should be set by validation, but just in case)
    const priority = typeof this.newTaskPriority === 'string' ? 
      parseInt(this.newTaskPriority, 10) : (this.newTaskPriority || 2);
    
    // Create new task
    const task = new scheduled_task(this.newTaskName.trim(), priority, new Date().toISOString());
    todoList.add_task(task);
    
    // Track save timestamp for hosted projects
    this.lastSaveTimestamp = Date.now();
    
    await this.dataService.saveProject(this.project, (this.project as any).projectType || 'local');
    this.loadProject(); // Reload to see the changes
    this.cdr.detectChanges();
    this.closeAddTaskModal();
  }

  // Full-screen todo list methods
  openFullScreenTodo(elementIndex: number, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    // Don't open if we're editing a name, dragging, or just finished dragging
    if (this.editingElementNameIndex === elementIndex && this.editingElementNameGridIndex === this.selectedGridIndex) {
      return;
    }
    if (this.isDraggingEnabled || this.justFinishedDragging) {
      this.justFinishedDragging = false;
      return;
    }

    if (!this.project || this.selectedGridIndex < 0) return;

    const element = this.project.grid[this.selectedGridIndex].Screen_elements[elementIndex];
    if (element && this.getElementType(element) === 'ToDoLst') {
      this.fullScreenTodoElement = element as ToDoLst;
      this.fullScreenTodoElementIndex = elementIndex;
      this.fullScreenTodoGridIndex = this.selectedGridIndex;
      this.showFullScreenTodo = true;
    }
  }

  closeFullScreenTodo(): void {
    this.showFullScreenTodo = false;
    this.fullScreenTodoElement = null;
    this.fullScreenTodoElementIndex = -1;
    this.fullScreenTodoGridIndex = -1;
    this.closeTaskComments();
  }

  async addTaskToFullScreenTodo(): Promise<void> {
    if (!this.fullScreenTodoElement || !this.newTaskName.trim()) return;

    // Convert datetime-local format to ISO string
    let taskTime = new Date().toISOString();
    if (this.newTaskTime) {
      // datetime-local format is YYYY-MM-DDTHH:mm, convert to ISO
      const localDate = new Date(this.newTaskTime);
      if (!isNaN(localDate.getTime())) {
        taskTime = localDate.toISOString();
      }
    }

    // Ensure priority is a number (it should be set by validation, but just in case)
    const priority = typeof this.newTaskPriority === 'string' ? 
      parseInt(this.newTaskPriority, 10) : (this.newTaskPriority || 2);

    const task = new scheduled_task(this.newTaskName.trim(), priority, taskTime);
    this.fullScreenTodoElement.add_task(task);
    
    // Track save timestamp for hosted projects
    this.lastSaveTimestamp = Date.now();
    
    await this.saveFullScreenTodo();
    this.newTaskName = '';
    this.newTaskPriority = null;
    this.newTaskTime = '';
  }

  getDateTimeLocalValue(isoString: string): string {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      // Format as YYYY-MM-DDTHH:mm for datetime-local input
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch {
      return '';
    }
  }

  async deleteTaskFromFullScreenTodo(task: scheduled_task): Promise<void> {
    if (!this.fullScreenTodoElement) return;

    const taskIndex = this.fullScreenTodoElement.scheduled_tasks.findIndex(t => t === task);
    if (taskIndex !== -1) {
      this.fullScreenTodoElement.delete_task(taskIndex);
      await this.saveFullScreenTodo();
    }
  }

  async toggleTaskStatusInFullScreen(task: scheduled_task): Promise<void> {
    if (!this.fullScreenTodoElement) return;

    task.toggle_done_status();
    await this.saveFullScreenTodo();
  }

  async updateTaskPriorityInFullScreen(task: scheduled_task, priority: number): Promise<void> {
    if (!this.fullScreenTodoElement) return;

    task.edit_priority(priority);
    await this.saveFullScreenTodo();
  }

  onPriorityChange(task: scheduled_task, event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (target) {
      this.updateTaskPriorityInFullScreen(task, +target.value);
    }
  }

  async saveFullScreenTodo(): Promise<void> {
    if (!this.project || this.fullScreenTodoGridIndex < 0 || this.fullScreenTodoElementIndex < 0) return;

    // Track save timestamp for hosted projects
    this.lastSaveTimestamp = Date.now();
    
    await this.dataService.saveProject(this.project, (this.project as any).projectType || 'local');
    this.loadProject();

    // Reload the full-screen todo element
    if (this.project && this.project.grid[this.fullScreenTodoGridIndex]) {
      const element = this.project.grid[this.fullScreenTodoGridIndex].Screen_elements[this.fullScreenTodoElementIndex];
      if (element && this.getElementType(element) === 'ToDoLst') {
        this.fullScreenTodoElement = element as ToDoLst;
      }
    }
    this.cdr.detectChanges();
  }

  getUpcomingTasks(): scheduled_task[] {
    if (!this.fullScreenTodoElement) return [];
    return this.fullScreenTodoElement.scheduled_tasks.filter(task => !task.is_done);
  }

  getCompletedTasks(): scheduled_task[] {
    if (!this.fullScreenTodoElement) return [];
    return this.fullScreenTodoElement.scheduled_tasks.filter(task => task.is_done);
  }

  formatTaskDate(timeString: string): string {
    if (!timeString || timeString === 'Invalid Date' || timeString.includes('Invalid')) return '';
    try {
      const date = new Date(timeString);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  toggleCompletedSection(): void {
    this.showCompletedTasks = !this.showCompletedTasks;
  }

  isTaskOverdue(task: scheduled_task): boolean {
    if (!task.get_time()) return false;
    try {
      const taskDate = new Date(task.get_time());
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      taskDate.setHours(0, 0, 0, 0);
      return taskDate < today && !task.is_done;
    } catch {
      return false;
    }
  }

  // Element name editing
  startEditingElementName(element: Screen_Element, gridIndex: number, elementIndex: number): void {
    this.editingElementName = String(element.get_name());
    this.editingElementNameIndex = elementIndex;
    this.editingElementNameGridIndex = gridIndex;
  }

  async saveElementName(): Promise<void> {
    if (!this.project || this.editingElementNameIndex < 0 || this.editingElementNameGridIndex < 0) return;

    const element = this.project.grid[this.editingElementNameGridIndex].Screen_elements[this.editingElementNameIndex];
    if (element && this.editingElementName.trim()) {
      element.set_name(this.editingElementName.trim());
      const projectType = (this.project as any).projectType;
      if (!projectType) {
        console.error(`[ProjectDetail] Cannot save project ${this.project.name} - projectType is missing!`);
        return;
      }
      await this.dataService.saveProject(this.project, projectType);
      this.loadProject();
    }

    this.cancelElementNameEdit();
  }

  cancelElementNameEdit(): void {
    this.editingElementName = '';
    this.editingElementNameIndex = -1;
    this.editingElementNameGridIndex = -1;
  }

  // Task reordering for full-screen todo
  draggedFullScreenTaskIndex: number = -1;
  dragOverTaskIndex: number = -1;

  onTaskDragStart(event: DragEvent, task: scheduled_task): void {
    if (!this.fullScreenTodoElement) return;
    this.draggedFullScreenTaskIndex = this.fullScreenTodoElement.scheduled_tasks.findIndex(t => t === task);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', '');
      // Use the dragged element as the drag image for a cleaner look
      const target = event.currentTarget as HTMLElement;
      if (target) {
        event.dataTransfer.setDragImage(target, 20, 20);
      }
    }
  }

  onTaskDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onTaskDragEnter(index: number): void {
    if (this.draggedFullScreenTaskIndex !== -1) {
      this.dragOverTaskIndex = index;
    }
  }

  onTaskDragLeave(event: DragEvent): void {
    // Only reset if leaving the element entirely (not entering a child)
    const relatedTarget = event.relatedTarget as HTMLElement;
    const currentTarget = event.currentTarget as HTMLElement;
    if (currentTarget && !currentTarget.contains(relatedTarget)) {
      this.dragOverTaskIndex = -1;
    }
  }

  async onTaskDrop(event: DragEvent, targetTask: scheduled_task): Promise<void> {
    event.preventDefault();
    this.dragOverTaskIndex = -1;
    if (this.draggedFullScreenTaskIndex === -1 || !this.fullScreenTodoElement) {
      this.draggedFullScreenTaskIndex = -1;
      return;
    }

    const tasks = this.fullScreenTodoElement.scheduled_tasks;
    const targetIndex = tasks.findIndex(t => t === targetTask);

    if (targetIndex === -1 || this.draggedFullScreenTaskIndex === targetIndex) {
      this.draggedFullScreenTaskIndex = -1;
      return;
    }

    const [movedTask] = tasks.splice(this.draggedFullScreenTaskIndex, 1);
    tasks.splice(targetIndex, 0, movedTask);

    await this.saveFullScreenTodo();
    this.draggedFullScreenTaskIndex = -1;
  }

  // Grid element dragging methods with long-press
  onElementMouseDown(event: MouseEvent, index: number): void {
    const target = event.target as HTMLElement;
    const card = event.currentTarget as HTMLElement;

    // Don't start drag if clicking on buttons
    if (target.tagName === 'BUTTON' || target.closest('button')) {
      return;
    }

    if (!card) return;

    // Show visual feedback immediately that long-press is starting
    this.longPressTargetIndex = index;

    // Start long-press timer for dragging (300ms)
    this.longPressTimer = setTimeout(() => {
      this.longPressTargetIndex = -1;
      this.isDraggingEnabled = true;
      const rect = card.getBoundingClientRect();
      this.elementDragOffsetX = event.clientX - rect.left;
      this.elementDragOffsetY = event.clientY - rect.top;
      this.draggedElementIndex = index;
      this.draggedElement = card;

      card.style.cursor = 'grabbing';
    }, 300);
  }

  onElementTouchStart(event: TouchEvent, element: Screen_Element, gridIndex: number, elementIndex: number): void {
  const target = event.target as HTMLElement;
  const card = event.currentTarget as HTMLElement;

  if (target.tagName === 'BUTTON' || target.closest('button')) {
    return;
  }

  if (!card) return;

  const touch = event.touches[0];

  this.longPressTargetIndex = elementIndex;

  this.longPressTimer = setTimeout(() => {
    this.longPressTargetIndex = -1;
    this.isDraggingEnabled = true;
    const rect = card.getBoundingClientRect();
    this.elementDragOffsetX = touch.clientX - rect.left;
    this.elementDragOffsetY = touch.clientY - rect.top;
    this.draggedElementIndex = elementIndex;
    this.draggedElement = card;
    card.style.cursor = 'grabbing';
  }, 300);
}

  onDocumentMouseMove(event: MouseEvent): void {
    // Phase 6b: broadcast local cursor position (throttled ~50ms) whenever the
    // pointer is over the canvas — independent of dragging state.
    this.emitCursor(event);

    if (!this.isDraggingEnabled || this.draggedElement === null || !this.project) return;

    const container = document.querySelector('.elements-grid') as HTMLElement;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = this.draggedElement.getBoundingClientRect();
    
    // Calculate position with offset
    let x = event.clientX - containerRect.left - this.elementDragOffsetX;
    let y = event.clientY - containerRect.top - this.elementDragOffsetY;
    
    // Get container dimensions (accounting for padding)
    const containerPadding = 20; // From CSS padding
    const maxX = container.clientWidth - elementRect.width - containerPadding;
    const maxY = container.clientHeight - elementRect.height - containerPadding;
    
    // Constrain within bounds
    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));

    this.draggedElement.style.position = 'absolute';
    this.draggedElement.style.left = x + 'px';
    this.draggedElement.style.top = y + 'px';
    this.draggedElement.style.zIndex = '1000';
  }

  onDocumentTouchMove(event: TouchEvent): void {
  if (this.isPanning) {
    event.preventDefault();
    const touch = event.touches[0];
    this.canvasPanX = touch.clientX - this.panStartX;
    this.canvasPanY = touch.clientY - this.panStartY;
    return;
  }

  if (this.isDraggingEnabled && this.draggedElement !== null && this.project) {
    event.preventDefault();
    const touch = event.touches[0];
    const container = document.querySelector('.elements-grid') as HTMLElement;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = this.draggedElement.getBoundingClientRect();

    let x = touch.clientX - containerRect.left - this.elementDragOffsetX;
    let y = touch.clientY - containerRect.top - this.elementDragOffsetY;

    const containerPadding = 20;
    const maxX = container.clientWidth - elementRect.width - containerPadding;
    const maxY = container.clientHeight - elementRect.height - containerPadding;

    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));

    this.draggedElement.style.position = 'absolute';
    this.draggedElement.style.left = x + 'px';
    this.draggedElement.style.top = y + 'px';
    this.draggedElement.style.zIndex = '1000';
  }
}

  async onDocumentMouseUp(event: MouseEvent): Promise<void> {
    // Clear long-press timer
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressTargetIndex = -1;

    if (!this.isDraggingEnabled) {
      return;
    }

    if (this.draggedElement === null || !this.project) {
      this.isDraggingEnabled = false;
      return;
    }

    const container = document.querySelector('.elements-grid') as HTMLElement;
    if (!container) {
      this.isDraggingEnabled = false;
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const elementRect = this.draggedElement.getBoundingClientRect();

    // Calculate position with offset
    let x = event.clientX - containerRect.left - this.elementDragOffsetX;
    let y = event.clientY - containerRect.top - this.elementDragOffsetY;

    // Get container dimensions (accounting for padding)
    const containerPadding = 20; // From CSS padding
    const maxX = container.clientWidth - elementRect.width - containerPadding;
    const maxY = container.clientHeight - elementRect.height - containerPadding;

    // Constrain within bounds
    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));

    // Save the position to the element
    const element = this.project.grid[this.selectedGridIndex].Screen_elements[this.draggedElementIndex];
    if (element) {
      if ((element as any).set_xpos) {
        (element as any).set_xpos(x);
        (element as any).set_ypos(y);
      } else {
        (element as any).x_pos = x;
        (element as any).y_pos = y;
      }
      // Phase 6b: final (un-throttled) move broadcast.
      this.emitElementMove(element, false);
      // Save to backend
      const projectType = (this.project as any).projectType;
      if (projectType) {
        await this.dataService.saveProject(this.project, projectType);
      }
    }

    this.draggedElement.style.cursor = 'grab';

    this.draggedElement = null;
    this.draggedElementIndex = -1;
    this.isDraggingEnabled = false;
    this.justFinishedDragging = true;

    // Reset flag after a short delay to allow click event
    setTimeout(() => {
      this.justFinishedDragging = false;
    }, 100);
  }

  async onDocumentTouchEnd(event: TouchEvent): Promise<void> {
  if (this.longPressTimer) {
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }
  this.longPressTargetIndex = -1;

  if (this.isPanning) {
    this.isPanning = false;
    return;
  }

  if (!this.isDraggingEnabled) {
    return;
  }

  if (this.draggedElement === null || !this.project) {
    this.isDraggingEnabled = false;
    return;
  }

  const container = document.querySelector('.elements-grid') as HTMLElement;
  if (!container) {
    this.isDraggingEnabled = false;
    return;
  }

  const touch = event.changedTouches[0];
  const containerRect = container.getBoundingClientRect();
  const elementRect = this.draggedElement.getBoundingClientRect();

  let x = touch.clientX - containerRect.left - this.elementDragOffsetX;
  let y = touch.clientY - containerRect.top - this.elementDragOffsetY;

  const containerPadding = 20;
  const maxX = container.clientWidth - elementRect.width - containerPadding;
  const maxY = container.clientHeight - elementRect.height - containerPadding;

  x = Math.max(0, Math.min(x, maxX));
  y = Math.max(0, Math.min(y, maxY));

  const element = this.project.grid[this.selectedGridIndex].Screen_elements[this.draggedElementIndex];
  if (element) {
    if ((element as any).set_xpos) {
      (element as any).set_xpos(x);
      (element as any).set_ypos(y);
    } else {
      (element as any).x_pos = x;
      (element as any).y_pos = y;
    }

    const projectType = (this.project as any).projectType;
    if (projectType) {
      await this.dataService.saveProject(this.project, projectType);
    }
  }

  this.draggedElement.style.cursor = 'grab';
  this.draggedElement = null;
  this.draggedElementIndex = -1;
  this.isDraggingEnabled = false;
  this.justFinishedDragging = true;

  setTimeout(() => {
    this.justFinishedDragging = false;
  }, 100);
}

  onElementMouseLeave(): void {
    // Only clear timer, don't stop dragging on leave
    if (!this.isDraggingEnabled && this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
      this.longPressTargetIndex = -1;
    }
  }

  getElementStyle(element: Screen_Element): any {
    // Handle both class instances and plain objects
    const xpos = (element as any).get_xpos ? (element as any).get_xpos() : ((element as any).x_pos || 0);
    const ypos = (element as any).get_ypos ? (element as any).get_ypos() : ((element as any).y_pos || 0);
    let xscale = (element as any).get_x_scale ? (element as any).get_x_scale() : ((element as any).x_scale || 200);
    let yscale = (element as any).get_y_scale ? (element as any).get_y_scale() : ((element as any).y_scale || 100);

    // Elements with default scale (1) should use auto sizing via CSS min-width/min-height
    // Don't set explicit tiny dimensions that could cause layout issues
    const style: any = {
      'left.px': xpos,
      'top.px': ypos,
      'position': 'absolute'
    };

    // Only set explicit width/height if they are reasonable (> default constructor value of 1)
    if (xscale > 10) {
      style['width.px'] = xscale;
    }
    if (yscale > 10) {
      style['height.px'] = yscale;
    }

    return style;
  }

  // Canvas methods
  onCanvasMouseDown(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('.canvas-element')) {
      return; // Don't pan if clicking on element
    }
    this.isPanning = true;
    this.panStartX = event.clientX - this.canvasPanX;
    this.panStartY = event.clientY - this.canvasPanY;
  }

  onCanvasMouseMove(event: MouseEvent): void {
    if (this.isPanning) {
      this.canvasPanX = event.clientX - this.panStartX;
      this.canvasPanY = event.clientY - this.panStartY;
      return;
    }

    if (this.isResizing && this.resizingElement) {
      const deltaX = event.clientX - this.startResizeX;
      const deltaY = event.clientY - this.startResizeY;

      let newWidth = this.startWidth + deltaX;
      let newHeight = this.startHeight + deltaY;

      // Minimum size constraints
      newWidth = Math.max(100, newWidth);
      newHeight = Math.max(50, newHeight);

      if ((this.resizingElement as any).set_x_scale) {
        (this.resizingElement as any).set_x_scale(newWidth);
        (this.resizingElement as any).set_y_scale(newHeight);
      } else {
        (this.resizingElement as any).x_scale = newWidth;
        (this.resizingElement as any).y_scale = newHeight;
      }
      this.dataService.updateCurrentUser();
      // Phase 6b: throttled granular resize broadcast.
      this.emitElementMove(this.resizingElement);
      return;
    }

    if (this.isDraggingEnabled && this.draggedElement) {
      const canvasContainer = document.querySelector('.canvas-container') as HTMLElement;
      if (!canvasContainer) return;

      const rect = canvasContainer.getBoundingClientRect();
      const x = (event.clientX - rect.left - this.elementDragOffsetX - this.canvasPanX) / this.canvasZoom;
      const y = (event.clientY - rect.top - this.elementDragOffsetY - this.canvasPanY) / this.canvasZoom;

      // Update the data model
      if (this.draggedElementGridIndex >= 0 && this.draggedElementIndex >= 0 && this.project) {
        const element = this.project.grid[this.draggedElementGridIndex].Screen_elements[this.draggedElementIndex];
        if (element) {
          if ((element as any).set_xpos) {
            (element as any).set_xpos(Math.max(0, x));
            (element as any).set_ypos(Math.max(0, y));
          } else {
            (element as any).x_pos = Math.max(0, x);
            (element as any).y_pos = Math.max(0, y);
          }
          this.dataService.updateCurrentUser();
          // Phase 6b: throttled granular move broadcast.
          this.emitElementMove(element);
        }
      }
    }
  }

  async onCanvasMouseUp(event: MouseEvent): Promise<void> {
    if (this.isDraggingEnabled && this.draggedElementGridIndex >= 0 && this.draggedElementIndex >= 0 && this.project) {
      // Save position when drag ends
      const element = this.project.grid[this.draggedElementGridIndex].Screen_elements[this.draggedElementIndex];
      if (element) {
        // Phase 6b: final (un-throttled) move broadcast.
        this.emitElementMove(element, false);
        const projectType = (this.project as any).projectType;
        if (!projectType) {
          console.error(`[ProjectDetail] Cannot save project ${this.project.name} - projectType is missing!`);
          return;
        }
        await this.dataService.saveProject(this.project, projectType);
      }
    }

    if (this.isResizing && this.resizingElement && this.project) {
      // Phase 6b: final (un-throttled) resize broadcast.
      this.emitElementMove(this.resizingElement, false);
      // Save size changes
      const projectType = (this.project as any).projectType;
      if (!projectType) {
        console.error(`[ProjectDetail] Cannot save project ${this.project.name} - projectType is missing!`);
        return;
      }
      await this.dataService.saveProject(this.project, projectType);
    }

    this.isPanning = false;
    this.isResizing = false;
    this.resizingElement = null;
    this.isDraggingEnabled = false;
    this.draggedElement = null;
  }

  onCanvasWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      this.canvasZoom = Math.max(0.5, Math.min(2, this.canvasZoom + delta));
    }
  }

  onCanvasElementMouseDown(event: MouseEvent, element: Screen_Element, gridIndex: number, elementIndex: number): void {
    const target = event.target as HTMLElement;

    // Don't drag if clicking on controls or resize handle
    if (target.closest('.element-controls') || target.closest('.resize-handle')) {
      return;
    }

    // Don't drag if double-clicking to edit
    if (event.detail === 2) {
      return;
    }

    event.stopPropagation();

    const elementEl = event.currentTarget as HTMLElement;
    this.draggedElement = elementEl;
    this.draggedElementIndex = elementIndex;
    this.draggedElementGridIndex = gridIndex;
    this.isDraggingEnabled = true;

    const rect = elementEl.getBoundingClientRect();
    const canvasContainer = document.querySelector('.canvas-container') as HTMLElement;
    if (canvasContainer) {
      const containerRect = canvasContainer.getBoundingClientRect();
      this.elementDragOffsetX = event.clientX - rect.left;
      this.elementDragOffsetY = event.clientY - rect.top;
    }
  }

  startResize(event: MouseEvent, element: Screen_Element, gridIndex: number, elementIndex: number, handle: string): void {
    event.stopPropagation();
    this.isResizing = true;
    this.resizeHandle = handle;
    this.resizingElement = element;
    this.resizingElementIndex = elementIndex;
    this.resizingElementGridIndex = gridIndex;
    this.startResizeX = event.clientX;
    this.startResizeY = event.clientY;
    this.startWidth = (element as any).get_x_scale ? (element as any).get_x_scale() : ((element as any).x_scale || 200);
    this.startHeight = (element as any).get_y_scale ? (element as any).get_y_scale() : ((element as any).y_scale || 100);
  }

  resetCanvasView(): void {
    this.canvasZoom = 1;
    this.canvasPanX = 0;
    this.canvasPanY = 0;
  }

  // Canvas toolbar methods
  canvasZoomIn(): void {
    this.canvasZoom = Math.min(3, this.canvasZoom + 0.1);
  }

  canvasZoomOut(): void {
    this.canvasZoom = Math.max(0.25, this.canvasZoom - 0.1);
  }

  canvasResetView(): void {
    this.resetCanvasView();
  }

  canvasFitToScreen(): void {
    if (!this.project || this.project.grid.length === 0 || !this.project.grid[this.selectedGridIndex]) {
      this.resetCanvasView();
      return;
    }

    const elements = this.project.grid[this.selectedGridIndex].Screen_elements;
    if (elements.length === 0) {
      this.resetCanvasView();
      return;
    }

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
      const x = (el as any).x_pos || 0;
      const y = (el as any).y_pos || 0;
      const w = this.getElementWidth(el);
      const h = 150; // Default height
      minX = Math.min(minX, x * 250);
      minY = Math.min(minY, y * 200);
      maxX = Math.max(maxX, x * 250 + w);
      maxY = Math.max(maxY, y * 200 + h);
    }

    const containerWidth = 800; // Approximate container width
    const containerHeight = 600; // Approximate container height

    const contentWidth = maxX - minX + 100;
    const contentHeight = maxY - minY + 100;

    this.canvasZoom = Math.min(containerWidth / contentWidth, containerHeight / contentHeight, 1);
    this.canvasPanX = (containerWidth - contentWidth * this.canvasZoom) / 2 - minX * this.canvasZoom + 50;
    this.canvasPanY = (containerHeight - contentHeight * this.canvasZoom) / 2 - minY * this.canvasZoom + 50;
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;
  }

  getElementWidth(element: Screen_Element): number {
    const xscale = (element as any).get_x_scale ? (element as any).get_x_scale() : ((element as any).x_scale || 1);
    if (xscale > 10) {
      return xscale;
    }
    // Default widths based on element type
    const type = this.getElementType(element);
    switch (type) {
      case 'ToDoLst': return 280;
      case 'Text_document': return 300;
      case 'Image': return 320;
      case 'Video': return 320;
      default: return 250;
    }
  }

  // Canvas helper methods for simplified template
  getCurrentGridElements(): Screen_Element[] {
    if (!this.project || !this.project.grid[this.selectedGridIndex]) {
      return [];
    }
    return this.project.grid[this.selectedGridIndex].Screen_elements;
  }

  // Get elements from the canvas (first grid)
  getElements(): Screen_Element[] {
    if (!this.project) {
      return [];
    }
    // Ensure at least one grid exists
    if (this.project.grid.length === 0) {
      this.project.create_grid('Canvas');
    }
    return this.project.grid[0].Screen_elements;
  }

  getElementX(element: Screen_Element, index: number): number {
    const x = (element as any).x_pos || 0;
    return x * 250 || index * 280;
  }

  getElementY(element: Screen_Element, index: number): number {
    const y = (element as any).y_pos || 0;
    return y * 200 || index * 180;
  }

  onCanvasClick(event: MouseEvent): void {
    // Deselect element when clicking on empty canvas
    if (!(event.target as HTMLElement).closest('.canvas-element')) {
      this.selectedElementIndex = -1;
    }
  }

  onElementDoubleClick(element: Screen_Element, index: number): void {
    // Open todo list in full screen on double click
    if (this.getElementType(element) === 'ToDoLst') {
      this.openFullScreenTodo(index);
    }
  }

  deleteSelected(): void {
    if (this.selectedElementIndex >= 0 && this.project) {
      this.deleteElement(this.selectedElementIndex);
    }
  }

  getTextPreview(element: Screen_Element): string {
    if (this.getElementType(element) === 'Text_document') {
      const text = (element as Text_document).Text_field || '';
      return text.substring(0, 100) + (text.length > 100 ? '...' : '');
    }
    return '';
  }

  onDocumentMouseDown(event: MouseEvent): void {
    // Handle canvas panning
    if ((event.target as HTMLElement).closest('.canvas-container') &&
      !(event.target as HTMLElement).closest('.canvas-element')) {
      this.onCanvasMouseDown(event);
    }
  }

  onDocumentTouchStart(event: TouchEvent): void {
  // Handle canvas panning
  if ((event.target as HTMLElement).closest('.canvas-container') && 
      !(event.target as HTMLElement).closest('.canvas-element')) {
    const touch = event.touches[0];
    this.isPanning = true;
    this.panStartX = touch.clientX - this.canvasPanX;
    this.panStartY = touch.clientY - this.canvasPanY;
  }
}

  async addTagToTodoList(todo: any) {
    const tag = this.editingTagInput.trim();
    if (!tag) return;

    if (!todo.tags.includes(tag)) {
      todo.tags.push(tag);
      console.log('Added tag:', tag, 'to todo:', todo);
      if (this.project) {
        await this.dataService.saveProject(this.project, this.project.project_type);
      }
    }

    this.editingTagInput = '';
  }

  async removeTagFromTodoList(todo: any, tag: string) {
    const i = todo.tags.indexOf(tag);
    if (i !== -1) {
      todo.tags.splice(i, 1);
      console.log('Removed tag:', tag, 'from todo:', todo);
      // await this.dataService.saveProject(this.project, (this.project as any).projectType);
      if (this.project) {
        await this.dataService.saveProject(this.project, this.project.project_type);
      }
    }
  }
  async addTagToFullScreen() {
    if (!this.fullScreenTodoElement) return;
    const tag = this.editingTagInput.trim();
    if (!tag) return;

    if (!this.fullScreenTodoElement.tags.includes(tag)) {
      this.fullScreenTodoElement.tags.push(tag);
      console.log('Added tag:', tag, 'to element:', this.fullScreenTodoElement);
      if (this.project) {
        await this.dataService.saveProject(this.project, this.project.project_type);
      }
    }

    this.editingTagInput = '';
  }

  async removeTagFromFullScreen(tag: string) {
    const el = this.fullScreenTodoElement;
    if (!el) return;
    const i = el.tags.indexOf(tag);
    if (i !== -1) {
      el.tags.splice(i, 1);
      console.log('Removed tag:', tag, 'from element:', el);
      if (this.project) {
        await this.dataService.saveProject(this.project, this.project.project_type);
      }
    }
  }
  getTags(element: any): string[] {
    console.log('Getting tags for element:', element);
  return element?.tags ?? [];
}

  // =========================================================================
  // B2: presence + cursor color palette (hash username -> accent spectrum)
  // =========================================================================

  private readonly accentSpectrum = [
    'var(--accent)',
    'var(--accent-blue)',
    'var(--accent-teal)',
    'var(--accent-green)',
    'var(--accent-lime)'
  ];

  /** Deterministically map a username to one of the album accent colors. */
  getUserColor(username: string): string {
    if (!username) return this.accentSpectrum[0];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = (hash * 31 + username.charCodeAt(i)) & 0x7fffffff;
    }
    return this.accentSpectrum[hash % this.accentSpectrum.length];
  }

  // =========================================================================
  // A2: dependency links on the canvas
  // =========================================================================

  /** All ToDoLst elements in the current grid (with their index). */
  private getTodoElements(): { element: Screen_Element; index: number }[] {
    const out: { element: Screen_Element; index: number }[] = [];
    this.getElements().forEach((element, index) => {
      if (this.getElementType(element) === 'ToDoLst') out.push({ element, index });
    });
    return out;
  }

  /** Center X of an element card (canvas-content coords). */
  getElementCenterX(element: Screen_Element, index: number): number {
    return this.getElementX(element, index) + this.getElementWidth(element) / 2;
  }

  /** Center Y of an element card (canvas-content coords). */
  getElementCenterY(element: Screen_Element, index: number): number {
    const yscale = (element as any).y_scale;
    const h = yscale && yscale > 10 ? yscale : 120;
    return this.getElementY(element, index) + h / 2;
  }

  /**
   * Renderable dependency links for the current grid. Each link is a straight
   * line from a source ToDoLst (the one that `dependsOn` another) to the target
   * it depends on, plus a `blocked` flag driving the color.
   */
  getDependencyLinks(): Array<{
    x1: number; y1: number; x2: number; y2: number; blocked: boolean; key: string;
  }> {
    const links: Array<{ x1: number; y1: number; x2: number; y2: number; blocked: boolean; key: string }> = [];
    const todos = this.getTodoElements();
    for (const { element, index } of todos) {
      const dependsOn = (element as any).dependsOn as string[] | undefined;
      if (!Array.isArray(dependsOn) || dependsOn.length === 0) continue;
      const sx = this.getElementCenterX(element, index);
      const sy = this.getElementCenterY(element, index);
      for (const targetId of dependsOn) {
        const target = todos.find(t => (t.element as any).id === targetId);
        if (!target) continue;
        const tx = this.getElementCenterX(target.element, target.index);
        const ty = this.getElementCenterY(target.element, target.index);
        links.push({
          x1: tx, y1: ty, x2: sx, y2: sy,
          blocked: !this.isElementComplete(target.element),
          key: `${(element as any).id}->${targetId}`
        });
      }
    }
    return links;
  }

  /** A blocking element is "done" (unblocks its dependents) when every task is done. */
  isElementComplete(element: Screen_Element): boolean {
    const tasks = this.getTodoTasks(element);
    if (tasks.length === 0) return false;
    return tasks.every((t: any) => t.is_done);
  }

  /** True if this ToDoLst is blocked by at least one incomplete dependency. */
  isElementBlocked(element: Screen_Element): boolean {
    const dependsOn = (element as any).dependsOn as string[] | undefined;
    if (!Array.isArray(dependsOn) || dependsOn.length === 0) return false;
    const todos = this.getTodoElements();
    return dependsOn.some(id => {
      const target = todos.find(t => (t.element as any).id === id);
      return target ? !this.isElementComplete(target.element) : false;
    });
  }

  /** Whether the "add dependency" affordance should be shown for an element. */
  canLinkElement(element: Screen_Element): boolean {
    return this.getElementType(element) === 'ToDoLst' && !!(element as any).id;
  }

  /** Start "pick target" mode from the given source ToDoLst element. */
  startLinkMode(element: Screen_Element, event?: MouseEvent): void {
    if (event) event.stopPropagation();
    const id = (element as any).id as string | undefined;
    if (!id) {
      this.showError('This todo list needs to sync with the server before it can link. Try again in a moment.');
      return;
    }
    this.linkSourceId = this.linkSourceId === id ? null : id;
    this.cdr.detectChanges();
  }

  cancelLinkMode(): void {
    this.linkSourceId = null;
    this.cdr.detectChanges();
  }

  /**
   * In link mode, clicking another ToDoLst sets the source's dependsOn to
   * include that target. Persists via whole-project save + granular collab.
   */
  async pickLinkTarget(element: Screen_Element, event?: MouseEvent): Promise<void> {
    if (!this.linkSourceId || !this.project) return;
    if (event) event.stopPropagation();
    const targetId = (element as any).id as string | undefined;
    if (!targetId || targetId === this.linkSourceId) {
      this.cancelLinkMode();
      return;
    }
    const found = this.findElementById(this.linkSourceId);
    this.linkSourceId = null;
    if (!found) return;

    const source = found.element as any;
    if (!Array.isArray(source.dependsOn)) source.dependsOn = [];
    if (source.dependsOn.includes(targetId)) {
      this.cdr.detectChanges();
      return;
    }
    source.dependsOn.push(targetId);
    this.dataService.updateCurrentUser();

    // Granular sync (element:update merges dependsOn into content JSONB).
    this.emitElementContent(found.element, { dependsOn: source.dependsOn });

    // Durable whole-project save.
    const projectType = (this.project as any).projectType || this.project.project_type;
    if (projectType) {
      this.lastSaveTimestamp = Date.now();
      await this.dataService.saveProject(this.project, projectType);
    }
    this.cdr.detectChanges();
  }

  /** Remove a single dependency from a ToDoLst element. */
  async removeDependency(element: Screen_Element, targetId: string, event?: MouseEvent): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.project) return;
    const source = element as any;
    if (!Array.isArray(source.dependsOn)) return;
    const i = source.dependsOn.indexOf(targetId);
    if (i === -1) return;
    source.dependsOn.splice(i, 1);
    this.dataService.updateCurrentUser();
    this.emitElementContent(element, { dependsOn: source.dependsOn });
    const projectType = (this.project as any).projectType || this.project.project_type;
    if (projectType) {
      this.lastSaveTimestamp = Date.now();
      await this.dataService.saveProject(this.project, projectType);
    }
    this.cdr.detectChanges();
  }

  /** dependsOn ids for a ToDoLst (empty array if none). */
  getDependencies(element: Screen_Element): string[] {
    const d = (element as any).dependsOn;
    return Array.isArray(d) ? d : [];
  }

  // =========================================================================
  // A3: task comments panel
  // =========================================================================

  /** Stable comment key for a task (the DB uuid attached on load, if present). */
  private getTaskId(task: scheduled_task | null): string | null {
    const id = (task as any)?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  /** Comment count badge for a task (0 when unknown). */
  getCommentCount(task: scheduled_task): number {
    const id = this.getTaskId(task);
    if (!id) return 0;
    return this.commentCounts.get(id) ?? 0;
  }

  /** True when the selected task can actually load/post comments. */
  get canComment(): boolean {
    return !!this.getTaskId(this.selectedCommentTask);
  }

  /** Open the comments panel for a task and load its comments. */
  async openTaskComments(task: scheduled_task, event?: MouseEvent): Promise<void> {
    if (event) event.stopPropagation();
    this.selectedCommentTask = task;
    this.taskComments = [];
    this.newCommentBody = '';
    const id = this.getTaskId(task);
    if (!id) {
      // No DB id yet (whole-project load doesn't emit task ids) — panel opens
      // with a hint instead of breaking.
      this.cdr.detectChanges();
      return;
    }
    this.isLoadingComments = true;
    this.cdr.detectChanges();
    try {
      const comments = await this.collabService.listComments(id);
      this.taskComments = comments;
      this.commentCounts.set(id, comments.length);
    } catch (e) {
      console.warn('[ProjectDetail] listComments failed:', e);
    } finally {
      this.isLoadingComments = false;
      this.cdr.detectChanges();
    }
  }

  closeTaskComments(): void {
    this.selectedCommentTask = null;
    this.taskComments = [];
    this.newCommentBody = '';
    this.cdr.detectChanges();
  }

  /** Post a new comment to the selected task. */
  async submitComment(): Promise<void> {
    const id = this.getTaskId(this.selectedCommentTask);
    const body = this.newCommentBody.trim();
    if (!id || !body) return;
    this.newCommentBody = '';
    try {
      // The broadcast (task:comment:added) delivers the comment to us too, so
      // we let applyRemoteComment append it to avoid duplication.
      await this.collabService.addComment(id, body);
    } catch (e) {
      console.warn('[ProjectDetail] addComment failed:', e);
      this.newCommentBody = body; // restore on failure
    }
    this.cdr.detectChanges();
  }

  /** Apply a broadcast comment: bump the count and append if its panel is open. */
  private applyRemoteComment(comment: TaskComment): void {
    if (!comment?.taskId) return;
    this.commentCounts.set(comment.taskId, (this.commentCounts.get(comment.taskId) ?? 0) + 1);
    const openId = this.getTaskId(this.selectedCommentTask);
    if (openId && openId === comment.taskId) {
      if (!this.taskComments.some(c => c.id === comment.id)) {
        this.taskComments = [...this.taskComments, comment];
      }
    }
    this.cdr.detectChanges();
  }

  /** Relative "time ago" label for a comment timestamp. */
  formatRelativeTime(iso: string): string {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const diff = Date.now() - then;
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    if (this.hostedProjectUpdateSubscription) {
      this.hostedProjectUpdateSubscription.unsubscribe();
    }
    if (this.hostedProjectDeleteSubscription) {
      this.hostedProjectDeleteSubscription.unsubscribe();
    }
    if (this.elementUpdateSubscription) {
      this.elementUpdateSubscription.unsubscribe();
    }

    // Phase 6b: leave the granular collaboration room and drop remote streams.
    this.collabService.leaveRoom();
    this.teardownCollabStreams();
    this.joinedRoomKey = null;

    // Clear any pending timeouts
    if (this.savingTimeout) {
      clearTimeout(this.savingTimeout);
    }
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }
  }



}

