import { Component, OnInit, OnDestroy, ChangeDetectorRef, PLATFORM_ID, Inject, DestroyRef, HostListener, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { DataService } from '../../../services/data.service';
import { SocketService } from '../../../services/socket.service';
import { CollabService, PresenceUser, ElementComment } from '../../../services/collab.service';
import { getServerConfig } from '../../../config/server.config';
import { User } from '../../../../../../shared_models/models/user.model';
import { Project, Grid } from '../../../../../../shared_models/models/project.model';
import { Screen_Element, ToDoLst, Text_document, Image, Video, scheduled_task, objects_builder } from '../../../../../../shared_models/models/screen-elements.model';
import { Subscription } from 'rxjs';
import { TextDocEditorComponent } from './text-doc-editor/text-doc-editor.component';
import { FullScreenTodoComponent } from './fullscreen-todo/fullscreen-todo.component';
import { ShareDialogComponent } from '../share-dialog/share-dialog.component';
import { ActivityFeedComponent } from '../activity-feed/activity-feed.component';
import { VersionHistoryComponent } from '../version-history/version-history.component';
import { IntegrationsService } from '../../../services/integrations.service';
import { ChatUiService } from '../../../services/chat-ui.service';
import { CanvasViewportService } from '../../../services/canvas-viewport.service';
import { DragEngineService } from '../../../services/drag-engine.service';
import { userColor } from '../../../utils/user-color.util';
import { ModalManager } from '../../../utils/modal-manager';

/** Every modal / overlay / menu this screen can open — the one list `modals` is keyed by. */
type ProjectDetailModal =
  | 'createGrid' | 'shareDialog' | 'activityFeed' | 'versionHistory' | 'exportMenu'
  | 'error' | 'confirm' | 'textEditor'
  | 'fullScreenTodo' | 'elementTypeSelector';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TextDocEditorComponent, FullScreenTodoComponent, ShareDialogComponent, ActivityFeedComponent, VersionHistoryComponent],
  templateUrl: './project-detail.component.html',
  styleUrls: ['./project-detail.component.css'],
  // Per-instance canvas state so each project visit starts fresh:
  // viewport = pan/zoom/grid; drag = long-press + drag/resize gesture session.
  providers: [CanvasViewportService, DragEngineService]
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
  /** All modal/overlay/menu open-state for this screen, in one object (replaces
   *  the old scatter of `showXModal` booleans). Public so the template reads it. */
  readonly modals = new ModalManager<ProjectDetailModal>();
  newGridName = '';

  // N1: sharing / access control.

  /** The current user's effective role on the loaded project ('owner'|'admin'|'editor'|'viewer'|null). */
  get projectRole(): string | null {
    return (this.project as any)?.role ?? null;
  }
  /** Owner/admin may open + change the Share dialog. */
  get canManageProject(): boolean {
    const r = this.projectRole;
    return r === 'owner' || r === 'admin';
  }
  /** Viewers are read-only (server also enforces this). */
  get canEditProject(): boolean {
    const p: any = this.project;
    if (!p) return false;
    // Fall back to editable when the flag is absent (older payloads / local edits).
    return p.canEdit !== false;
  }
  /** Project owner's display name for the Share dialog's pinned owner row. */
  get projectOwnerName(): string {
    const p: any = this.project;
    return p?.owner_name ?? p?.owner_username ?? '';
  }

  openShareDialog(): void { this.modals.open('shareDialog'); }
  closeShareDialog(): void { this.modals.close('shareDialog'); }

  // N2: per-project activity feed.
  openActivityFeed(): void { this.modals.open('activityFeed'); }
  closeActivityFeed(): void { this.modals.close('activityFeed'); }

  // E8: canvas version history / restore.
  openVersionHistory(): void { this.modals.open('versionHistory'); }
  closeVersionHistory(): void { this.modals.close('versionHistory'); }
  /** After a restore (by us) the canvas was full-replaced server-side — reload it. */
  onVersionRestored(): void {
    this.modals.close('versionHistory');
    this.reloadProjectFromServer();
  }

  // N10: project export (JSON / Markdown download + browser print-to-PDF).
  toggleExportMenu(event?: Event): void {
    event?.stopPropagation();
    this.modals.toggle('exportMenu');
  }
  private get projectTypeParam(): 'local' | 'hosted' {
    return ((this.project as any)?.projectType as 'local' | 'hosted') || 'local';
  }
  exportJson(): void {
    this.modals.close('exportMenu');
    if (this.project) this.integrations.exportProject(this.project.name, this.projectTypeParam, 'json');
  }
  exportMarkdown(): void {
    this.modals.close('exportMenu');
    if (this.project) this.integrations.exportProject(this.project.name, this.projectTypeParam, 'md');
  }
  /** Open a clean, print-styled view of the project and trigger the browser's
   *  print dialog (the user picks "Save as PDF"). Built client-side from the
   *  already-loaded project — no server round-trip. */
  printProject(): void {
    this.modals.close('exportMenu');
    if (!this.project || !isPlatformBrowser(this.platformId)) return;
    const html = this.buildPrintHtml(this.project);
    const win = window.open('', '_blank', 'width=820,height=1000');
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    // Let the new document lay out before invoking print.
    setTimeout(() => win.print(), 300);
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private buildPrintHtml(project: any): string {
    const esc = (v: unknown) => this.escapeHtml(v);
    const prio = (p: number) => (p <= 1 ? 'High' : p === 2 ? 'Medium' : 'Low');
    const sections: string[] = [];

    for (const grid of (project.grid || [])) {
      const parts: string[] = [`<h2>${esc(grid.name || 'Grid')}</h2>`];
      for (const el of (grid.Screen_elements || [])) {
        const type = el?.type ?? el?.constructor?.name ?? 'Element';
        parts.push(`<h3>${esc(el?.name || 'Untitled')} <span class="tag">${esc(type)}</span></h3>`);
        if (type === 'ToDoLst') {
          const tasks: any[] = el.scheduled_tasks || [];
          if (!tasks.length) { parts.push('<p class="muted">No tasks.</p>'); continue; }
          parts.push('<ul class="tasks">');
          for (const t of tasks) {
            const box = t.is_done ? '☑' : '☐';
            const meta: string[] = [];
            if (t.time) meta.push(new Date(t.time).toLocaleString());
            if (typeof t.priority === 'number') meta.push(prio(t.priority));
            const metaStr = meta.length ? ` <span class="muted">(${esc(meta.join(' · '))})</span>` : '';
            parts.push(`<li class="${t.is_done ? 'done' : ''}">${box} ${esc(t.taskname)}${metaStr}</li>`);
          }
          parts.push('</ul>');
        } else if (type === 'Text_document') {
          parts.push(`<p>${esc(el.Text_field).replace(/\n/g, '<br>') || '<span class="muted">Empty document.</span>'}</p>`);
        } else if (type === 'Image' && el.imagepath) {
          parts.push(`<p class="muted">Image: ${esc(el.imagepath)}</p>`);
        } else if (type === 'Video' && el.VideoPath) {
          parts.push(`<p class="muted">Video: ${esc(el.VideoPath)}</p>`);
        }
      }
      sections.push(parts.join('\n'));
    }

    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)}</title>
<style>
  *{box-sizing:border-box}
  body{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;max-width:720px;margin:40px auto;padding:0 24px}
  h1{font-size:26px;margin:0 0 4px}
  h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid #e5e5e5;padding-bottom:4px}
  h3{font-size:15px;margin:16px 0 6px}
  .tag{font-size:11px;color:#888;font-weight:400;border:1px solid #ddd;border-radius:4px;padding:1px 6px;margin-left:6px}
  .sub{color:#777;margin:0 0 8px}
  ul.tasks{list-style:none;padding:0;margin:6px 0}
  ul.tasks li{padding:2px 0}
  ul.tasks li.done{color:#999;text-decoration:line-through}
  .muted{color:#999}
  @media print{body{margin:0}}
</style></head><body>
  <h1>${esc(project.name)}</h1>
  <p class="sub">Owner: ${esc(project.owner_name || project.owner_username || '')} · ${esc(this.projectTypeParam)} · Exported ${new Date().toLocaleString()}</p>
  ${sections.join('\n') || '<p class="muted">This project has no content yet.</p>'}
</body></html>`;
  }

  /** N10: close the export menu on any outside click. */
  @HostListener('document:click')
  closeExportMenuOnOutsideClick(): void {
    if (this.modals.isOpen('exportMenu')) this.modals.close('exportMenu');
  }
  
  // Error/Alert modal
  errorMessage = '';

  // Confirmation modal
  confirmMessage = '';
  gridToDelete: { index: number; grid: Grid } | null = null;
  elementToDelete: { index: number; element: Screen_Element } | null = null;
  newElementType: 'ToDoLst' | 'Image' | 'Video' | 'Text_document' = 'ToDoLst';
  private lastSaveTimestamp = 0; // Track when we last saved to prevent reload loop
  isEditingText = false;
  editingTextIndex = -1;
  editingTextContent = '';

  // B3: collaborative rich-text editor overlay (Yjs). Opened on double-click of
  // a Text_document; the overlay owns the Y.Doc + Quill binding + live sync.
  textEditorElement: Text_document | null = null;

  // Full-screen todo list view
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

  // Canvas long-press + drag/resize gesture session lives in `drag`
  // (DragEngineService), injected below. Kept here: the click-suppression gate
  // that swallows the click synthesized right after a drag ends.
  justFinishedDragging: boolean = false;

  // New element on canvas
  fileInput: HTMLInputElement | null = null;

  // Canvas viewport state (pan/zoom/grid + screen<->canvas coord math) lives in
  // `viewport` (CanvasViewportService), injected below.

  // Loading states
  isSaving = false;
  isLoading = false;
  private savingTimeout: any = null;
  private loadingTimeout: any = null;

  // Subscriptions
  private hostedProjectUpdateSubscription: any;
  private hostedProjectDeleteSubscription: any;
  private elementUpdateSubscription: any;

  // Document-level listeners registered in ngOnInit. Kept here (with their exact
  // handler references) so ngOnDestroy can remove them — otherwise every visit to
  // a project stacked another permanent set of listeners, each holding a dead
  // component alive and still firing its drag/mouse/keyboard handlers.
  private documentListeners: Array<{ type: string; handler: EventListener; opts?: AddEventListenerOptions }> = [];

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

  // ---- E6: canvas comment pins (element_comments) ----
  /** Every comment pinned to an element in this project (open + resolved). */
  elementComments = signal<ElementComment[]>([]);
  /** The element whose comment thread popover is open, plus its screen anchor. */
  commentThread = signal<{ elementId: string; elementName: string; x: number; y: number } | null>(null);
  /** Composer draft for the open thread. */
  commentDraft = '';
  /** True while a comment create/resolve/delete round-trip is in flight. */
  commentBusy = signal<boolean>(false);

  // ---- A2: dependency links on the canvas ----
  /** When set, we're in "pick a target ToDoLst" mode; value is the source element id. */
  linkSourceId: string | null = null;

  // =========================================================================
  // G2: multi-select, group move, grid snapping, templates (signal-based)
  // =========================================================================
  /** Indices (into the current grid's Screen_elements) that are multi-selected. */
  selectedIndices = signal<Set<number>>(new Set<number>());
  /** Whether drop-time grid snapping is enabled (toolbar toggle, default on). */
  snapEnabled = signal<boolean>(true);
  /** Marquee (shift+drag on empty canvas) rectangle in canvas-content coords, or null. */
  marquee = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  /** True while the templates dropdown menu is open. */
  showTemplatesMenu = signal<boolean>(false);

  // Marquee drag internals (canvas-content coords for start point).
  private isMarqueeSelecting = false;
  private marqueeStartX = 0;
  private marqueeStartY = 0;
  /** Grid unit → pixel factors, matching getElementX/Y (×250 / ×200). */
  private readonly GRID_PX_X = 250;
  private readonly GRID_PX_Y = 200;
  /** Snap increment in grid units. */
  private readonly SNAP_UNIT = 0.5;

  constructor(
    private dataService: DataService,
    private socketService: SocketService,
    private collabService: CollabService,
    private route: ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
    private destroyRef: DestroyRef,
    private integrations: IntegrationsService,
    private chatUi: ChatUiService,
    public viewport: CanvasViewportService,
    public drag: DragEngineService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  ngOnInit(): void {
    this.route.params.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.projectIndex = +params['id'];
      this.loadProject();
    });

    this.dataService.currentUser$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user: User | null) => {
      this.currentUser = user;
      this.loadProject();
    });

    // Subscribe to loading states
    this.dataService.savingProject$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(loading => {
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

    this.dataService.loadingProject$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(loading => {
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

    // Global drag/pan/keyboard listeners (only in browser). Registered through a
    // helper that records each handler so ngOnDestroy can remove it — see
    // `documentListeners`.
    if (isPlatformBrowser(this.platformId)) {
      this.addDocumentListener('mousemove', (e) => this.onDocumentMouseMove(e as MouseEvent));
      this.addDocumentListener('mouseup', (e) => this.onDocumentMouseUp(e as MouseEvent));
      this.addDocumentListener('mousedown', (e) => this.onDocumentMouseDown(e as MouseEvent));
      this.addDocumentListener('touchmove', (e) => this.onDocumentTouchMove(e as TouchEvent), { passive: false });
      this.addDocumentListener('touchend', (e) => this.onDocumentTouchEnd(e as TouchEvent));
      this.addDocumentListener('touchstart', (e) => this.onDocumentTouchStart(e as TouchEvent));
      // G2: canvas keyboard shortcuts (select-all / clear / delete selection).
      this.addDocumentListener('keydown', (e) => this.onDocumentKeyDown(e as KeyboardEvent));
    }
  }

  /** Register a document listener and remember it so ngOnDestroy can remove it. */
  private addDocumentListener(type: string, handler: EventListener, opts?: AddEventListenerOptions): void {
    document.addEventListener(type, handler, opts);
    this.documentListeners.push({ type, handler, opts });
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
      // Publish this project's channel so the chat panel can offer team chat.
      const projectType = (this.project as any).projectType || this.project.project_type;
      this.chatUi.setProjectChannel({
        projectName: this.project.name,
        projectType,
        label: `${this.project.name} · team`,
      });
    }
  }

  /** Open the slide-in chat panel on this project's team channel. */
  openTeamChat(): void {
    if (!this.project) return;
    const projectType = (this.project as any).projectType || this.project.project_type;
    this.chatUi.openProject(this.project.name, projectType);
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
      // E6: hydrate the canvas comment pins for this project.
      const comments = await this.collabService.listElementComments();
      this.elementComments.set(comments);
      this.cdr.detectChanges();
    } catch (e) {
      console.warn('[ProjectDetail] joinProjectRoom failed (collab disabled):', e);
    }
  }

  private teardownCollabStreams(): void {
    this.collabSubscriptions.forEach(s => s.unsubscribe());
    this.collabSubscriptions = [];
    this.remoteCursors.clear();
    // E6: drop this project's comment pins + close any open thread.
    this.elementComments.set([]);
    this.commentThread.set(null);
    this.commentDraft = '';
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
      // E6: canvas comment pins — reconcile create/resolve/delete broadcasts.
      this.collabService.onElementCommentCreated().subscribe(c => this.upsertComment(c)),
      this.collabService.onElementCommentResolved().subscribe(c => this.upsertComment(c)),
      this.collabService.onElementCommentDeleted().subscribe(({ commentId }) => this.removeComment(commentId)),
      // E8: a peer restored a version — the canvas was full-replaced server-side,
      // so reload it from the server to pick up the restored state.
      this.collabService.onSnapshotRestored().subscribe(() => this.reloadProjectFromServer())
    );
  }

  /** E6: insert or replace a comment in local state (by id), keeping order stable. */
  private upsertComment(comment: ElementComment): void {
    this.elementComments.update(list => {
      const i = list.findIndex(c => c.id === comment.id);
      if (i < 0) return [...list, comment];
      const next = list.slice();
      next[i] = comment;
      return next;
    });
    this.cdr.detectChanges();
  }

  /** E6: drop a comment from local state (by id). */
  private removeComment(commentId: string): void {
    this.elementComments.update(list => list.filter(c => c.id !== commentId));
    this.cdr.detectChanges();
  }

  // ---- Helpers to locate elements by stable id across grids ----

  /** Find an element (and its grid) by its stable id. */
  private findElementById(elementId: string): { element: Screen_Element; gridIndex: number; elementIndex: number } | null {
    if (!this.project || !elementId) return null;
    for (let g = 0; g < this.project.grid.length; g++) {
      const els = this.project.grid[g].Screen_elements;
      for (let i = 0; i < els.length; i++) {
        if (els[i].id === elementId) {
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
    if (data.element.id && !rebuilt.id) rebuilt.id = data.element.id;

    // Skip if we already have this element (id already present).
    if (rebuilt.id && this.findElementById(rebuilt.id)) return;

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
    const el = found.element;
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
    const id = element.id;
    if (!id || this.isApplyingRemote(id)) return; // missing id -> rely on whole-project save
    if (throttle) {
      const now = Date.now();
      if (now - this.lastMoveEmit < 50) return;
      this.lastMoveEmit = now;
    }
    this.collabService.emitMove(id, element.x_pos ?? 0, element.y_pos ?? 0, element.x_scale ?? 1, element.y_scale ?? 1);
  }

  /** Emit a granular content patch (e.g. Text_field) for an element. */
  private emitElementContent(element: Screen_Element, content: any): void {
    const id = element.id;
    if (!id || this.isApplyingRemote(id)) return;
    this.collabService.emitContentUpdate(id, content);
  }

  /** Emit a granular delete for an element. */
  private emitElementDelete(element: Screen_Element): void {
    const id = element.id;
    if (!id) return;
    this.collabService.emitDelete(id);
  }

  /**
   * Emit a granular create for a freshly-added element and CAPTURE the server's
   * authoritative stable id onto the local element. Capturing the id is what
   * lets the element's subsequent move/edit/delete ops sync — without it a
   * brand-new element would silently drop those ops until a full reload.
   *
   * The backend also persists this one row and broadcasts `element:created` to
   * peers. A whole-project save run AFTER this reuses the captured id (see
   * `addElementCollab` / `persistTemplate`), so the row the granular create
   * inserted is replaced in place rather than left as a duplicate.
   */
  private async emitElementCreate(element: Screen_Element, gridIndex: number): Promise<void> {
    if (!this.project || !this.project.grid[gridIndex]) return;
    const gridId = (this.project.grid[gridIndex] as any).id as string | undefined;
    if (!gridId) return; // no grid id -> rely on whole-project save
    const created = await this.collabService.emitCreate(
      gridId,
      (element as any).toJSON ? (element as any).toJSON() : element
    );
    if (created && (created as any).id) {
      (element as any).id = (created as any).id;
    }
  }

  /**
   * Canonical "add a freshly-created element" path with correct collab
   * semantics:
   *   1. granular `element:create` FIRST — captures the authoritative id onto
   *      the element and delivers it to peers live,
   *   2. then the whole-project save (durable), which reuses that id and so
   *      leaves a single row instead of a duplicate.
   * Degrades to a plain add + whole-project save when no collab room is joined.
   */
  private async addElementCollab(element: Screen_Element, gridIndex: number): Promise<void> {
    if (!this.project) return;
    // Defensive backstop: if the target grid doesn't exist (e.g. a gridless
    // brand-new project reached via a template or empty-canvas CTA), create a
    // default one and retarget it rather than silently dropping the element.
    if (!this.project.grid[gridIndex]) {
      await this.ensureDefaultGrid();
      gridIndex = this.selectedGridIndex;
    }
    if (!this.project.grid[gridIndex]) return;
    await this.emitElementCreate(element, gridIndex);
    await this.dataService.addElementToGrid(this.projectIndex, gridIndex, element);
    this.loadProject();
    this.cdr.detectChanges();
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
    const x = this.viewport.toCanvasX(event.clientX, rect.left);
    const y = this.viewport.toCanvasY(event.clientY, rect.top);

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

  // ---- E7: presence avatar stack (overflow + self-marking) ----
  /** Max avatars rendered before collapsing the rest into a "+N" chip. */
  private readonly MAX_PRESENCE_AVATARS = 5;

  /** The avatars actually rendered in the topbar (capped). */
  getVisiblePresence(): PresenceUser[] {
    return this.presenceUsers.slice(0, this.MAX_PRESENCE_AVATARS);
  }

  /** How many present users are hidden behind the "+N" chip. */
  getPresenceOverflow(): number {
    return Math.max(0, this.presenceUsers.length - this.MAX_PRESENCE_AVATARS);
  }

  /** True when a presence entry is the current user (labelled "you"). */
  isSelfPresence(username: string): boolean {
    return !!this.currentUser?.name && username === this.currentUser.name;
  }

  /** Tooltip for a presence avatar ("Alice" / "Alice (you)"). */
  presenceTooltip(username: string): string {
    return this.isSelfPresence(username) ? `${username} (you)` : username;
  }

  // =========================================================================
  // E6: canvas comment pins (element_comments)
  // =========================================================================

  /**
   * Renderable comment pins: one per element that has at least one OPEN
   * (unresolved) comment. Positioned in canvas-content coords at the element's
   * top-right corner (computed with the same getElementX/Y/Width helpers the
   * cards use), so the pin lives inside `.canvas-area` and survives pan/zoom.
   */
  getCommentPins(): { elementId: string; x: number; y: number; count: number }[] {
    const openByElement = new Map<string, number>();
    for (const c of this.elementComments()) {
      if (c.resolvedBy) continue;
      openByElement.set(c.elementId, (openByElement.get(c.elementId) ?? 0) + 1);
    }
    if (openByElement.size === 0) return [];
    const pins: { elementId: string; x: number; y: number; count: number }[] = [];
    this.getElements().forEach((el, i) => {
      const count = el.id ? openByElement.get(el.id) : undefined;
      if (!el.id || !count) return;
      pins.push({
        elementId: el.id,
        x: this.getElementX(el, i) + this.getElementWidth(el) - 10,
        y: this.getElementY(el, i) - 10,
        count,
      });
    });
    return pins;
  }

  /** Count of OPEN comments on an element (drives the header badge). */
  getElementCommentCount(element: Screen_Element): number {
    if (!element.id) return 0;
    return this.elementComments().filter(c => c.elementId === element.id && !c.resolvedBy).length;
  }

  /** Comments for the currently-open thread, oldest-first. */
  getThreadComments(): ElementComment[] {
    const thread = this.commentThread();
    if (!thread) return [];
    return this.elementComments().filter(c => c.elementId === thread.elementId);
  }

  /**
   * Open (or toggle closed) the comment thread for an element. Anchored to the
   * click position in SCREEN space, so the popover is constant-size regardless
   * of zoom (a sibling of `.canvas-container`, not inside the transformed area).
   */
  openCommentThread(element: Screen_Element, event: MouseEvent): void {
    event.stopPropagation();
    if (!element.id) return;
    const current = this.commentThread();
    if (current && current.elementId === element.id) {
      this.closeCommentThread();
      return;
    }
    // Clamp the anchor so the popover stays on-screen near the click.
    const vw = isPlatformBrowser(this.platformId) ? window.innerWidth : 1200;
    const vh = isPlatformBrowser(this.platformId) ? window.innerHeight : 800;
    this.commentThread.set({
      elementId: element.id,
      elementName: String(element.name ?? 'Element'),
      x: Math.max(12, Math.min(event.clientX, vw - 340)),
      y: Math.max(12, Math.min(event.clientY, vh - 360)),
    });
    this.commentDraft = '';
    this.cdr.detectChanges();
  }

  /** Open the thread for a pin (looks the element up by id). */
  openThreadForPin(elementId: string, event: MouseEvent): void {
    const found = this.findElementById(elementId);
    if (found) this.openCommentThread(found.element, event);
  }

  closeCommentThread(): void {
    this.commentThread.set(null);
    this.commentDraft = '';
    this.cdr.detectChanges();
  }

  /** Post the composer draft as a new comment on the open thread's element. */
  async submitComment(): Promise<void> {
    const thread = this.commentThread();
    const body = this.commentDraft.trim();
    if (!thread || !body || this.commentBusy()) return;
    this.commentBusy.set(true);
    const draft = this.commentDraft;
    this.commentDraft = '';
    try {
      const created = await this.collabService.createElementComment(thread.elementId, body);
      // The room broadcast also echoes this back; upsert dedupes by id.
      this.upsertComment(created);
    } catch (e) {
      console.warn('[ProjectDetail] add comment failed:', e);
      this.commentDraft = draft; // restore so the user doesn't lose their text
    } finally {
      this.commentBusy.set(false);
      this.cdr.detectChanges();
    }
  }

  /** Toggle a comment's resolved state. */
  async toggleResolveComment(comment: ElementComment): Promise<void> {
    if (this.commentBusy()) return;
    this.commentBusy.set(true);
    try {
      const updated = await this.collabService.resolveElementComment(comment.id, !comment.resolvedBy);
      this.upsertComment(updated);
    } catch (e) {
      console.warn('[ProjectDetail] resolve comment failed:', e);
    } finally {
      this.commentBusy.set(false);
      this.cdr.detectChanges();
    }
  }

  /** Delete a comment. */
  async removeCommentAction(comment: ElementComment): Promise<void> {
    if (this.commentBusy()) return;
    this.commentBusy.set(true);
    try {
      await this.collabService.deleteElementComment(comment.id);
      this.removeComment(comment.id);
    } catch (e) {
      console.warn('[ProjectDetail] delete comment failed:', e);
    } finally {
      this.commentBusy.set(false);
      this.cdr.detectChanges();
    }
  }

  /** Whether the current user authored a comment (drives delete affordance). */
  isOwnComment(comment: ElementComment): boolean {
    return !!this.currentUser?.name && comment.author === this.currentUser.name;
  }

  /** Short timestamp for a comment. */
  formatCommentTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /** Enter submits the composer; Shift+Enter inserts a newline. */
  onCommentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submitComment();
    }
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
    this.modals.open('createGrid');
    this.newGridName = '';
  }

  closeCreateGridModal(): void {
    this.modals.close('createGrid');
    this.newGridName = '';
  }

  showError(message: string): void {
    this.errorMessage = message;
    this.modals.open('error');
  }

  closeErrorModal(): void {
    this.modals.close('error');
    this.errorMessage = '';
  }

  showConfirmation(message: string, index: number, grid: Grid): void {
    this.confirmMessage = message;
    this.gridToDelete = { index, grid };
    this.modals.open('confirm');
  }

  closeConfirmModal(): void {
    this.modals.close('confirm');
    this.confirmMessage = '';
    this.gridToDelete = null;
    this.elementToDelete = null;
  }

  /** Confirm button on the delete dialog — routes to the grid or element handler
   *  depending on which delete was requested (only one is ever pending). */
  confirmDelete(): void {
    if (this.gridToDelete) {
      this.confirmDeleteGrid();
    } else if (this.elementToDelete) {
      this.confirmDeleteElement();
    } else {
      this.closeConfirmModal();
    }
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

  async openAddElementModal(): Promise<void> {
    if (!this.project) return;
    // Brand-new projects are created with an empty grid array (the Project
    // constructor starts with `grid: []` and normal project creation never adds
    // one). Without a grid, every add-element path silently no-ops — so an image
    // (or any element) "won't go inside". Ensure a default canvas exists first.
    if (this.project.grid.length === 0) {
      await this.ensureDefaultGrid();
    }
    if (!this.project || this.project.grid.length === 0) {
      this.showError('Could not create a canvas for this project. Please try again.');
      return;
    }
    this.modals.open('elementTypeSelector');
    this.cdr.detectChanges(); // Force change detection
  }

  /**
   * Ensure the current project has at least one grid, creating a default
   * "Main Canvas" if it has none, and point `selectedGridIndex` at it. Elements
   * are always added to a grid, so this guards every add-element entry point
   * against silently dropping the element on a gridless project.
   */
  private async ensureDefaultGrid(): Promise<void> {
    if (!this.project || this.project.grid.length > 0) return;
    await this.dataService.createGrid(this.projectIndex, 'Main Canvas');
    this.selectedGridIndex = 0;
    this.loadProject();
  }

  selectElementType(type: 'ToDoLst' | 'Image' | 'Video' | 'Text_document'): void {
    this.newElementType = type;
    this.modals.close('elementTypeSelector');

    if (type === 'Image') {
      this.triggerImageUpload();
    } else if (type === 'Video') {
      this.triggerVideoUpload();
    } else if (type === 'Text_document') {
      this.createTextElement();
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
      // Phase 6b (B1): granular create (captures id + notifies peers) then save.
      await this.addElementCollab(element, this.selectedGridIndex);
    } catch (error) {
      console.error('[ProjectDetail] createTodoElement error:', error);
    }
  }

  /**
   * Create a Text_document immediately with a default name (mirrors
   * createTodoElement — the add flow has no name prompt). The user renames it
   * inline and edits the body via the double-click rich-text editor. Replaces
   * the old add-text modal, whose template was removed (the flow was dead).
   */
  async createTextElement(): Promise<void> {
    if (!this.project || this.selectedGridIndex < 0) {
      console.error('[ProjectDetail] createTextElement: no project or invalid grid index');
      return;
    }
    try {
      const element = new Text_document('Text Document', 20, 20, '');
      element.x_scale = 300;
      element.y_scale = 200;
      // Phase 6b (B1): granular create (captures id + notifies peers) then save.
      await this.addElementCollab(element, this.selectedGridIndex);
    } catch (error) {
      console.error('[ProjectDetail] createTextElement error:', error);
    }
  }

  triggerImageUpload(): void {
    // A14: SSR guard — `document` doesn't exist on the server. Only reached from a
    // user gesture in the browser, but guard defensively so the component never
    // touches the DOM outside a browser platform.
    if (!isPlatformBrowser(this.platformId)) return;
    // Reset file input to ensure accept attribute is correct
    if (this.fileInput) {
      this.fileInput.remove();
    }
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*';
    this.fileInput.onchange = () => {
      if (this.fileInput && this.fileInput.files && this.fileInput.files.length > 0) {
        const file = this.fileInput.files[0];
        // Immediate create (the name-prompt modal was removed): use the file name
        // (sans extension) as the element name; the user can rename it later.
        this.handleImageUpload(file, this.defaultElementName(file.name));
      }
    };
    this.fileInput.click();
  }

  /** File name without its extension, for use as a default element name. */
  private defaultElementName(fileName: string): string {
    return fileName.replace(/\.[^./\\]+$/, '') || fileName;
  }

  triggerVideoUpload(): void {
    // A14: SSR guard — see triggerImageUpload. `document` is browser-only.
    if (!isPlatformBrowser(this.platformId)) return;
    // Reset file input to ensure accept attribute is correct
    if (this.fileInput) {
      this.fileInput.remove();
    }
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'video/*';
    this.fileInput.onchange = () => {
      if (this.fileInput && this.fileInput.files && this.fileInput.files.length > 0) {
        const file = this.fileInput.files[0];
        // Immediate create (the name-prompt modal was removed): use the file name.
        this.handleVideoUpload(file, this.defaultElementName(file.name));
      }
    };
    this.fileInput.click();
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
          // A11: filePath now already includes the local/hosted segment, so it
          // appends directly to the /projects static route.
          const serverUrl = getServerConfig();
          const localPath = `${serverUrl}/projects/${uploadResponse.filePath}`;
          console.log(`[ProjectDetail] Image uploaded, using path: ${localPath}`);
          const element = new Image(localPath, 400, 300, imageName);
          element.set_x_scale(300); // width
          element.set_y_scale(200); // height
          console.log(`[ProjectDetail] Created Image element:`, {
            name: element.name,
            imagepath: element.imagepath,
            toJSON: element.toJSON()
          });
          // Phase 6b (B1): granular create (captures id + notifies peers) then save.
          await this.addElementCollab(element, this.selectedGridIndex);
          this.socketService.emitElementUpdate(element, this.project!.name, this.project!.grid[this.selectedGridIndex].name);
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
          // A11: filePath now already includes the local/hosted segment, so it
          // appends directly to the /projects static route.
          const serverUrl = getServerConfig();
          const localPath = `${serverUrl}/projects/${uploadResponse.filePath}`;
          console.log(`[ProjectDetail] Video uploaded, using path: ${localPath}`);
          const element = new Video(localPath, 400, 300, videoName);
          element.set_x_scale(400); // width
          element.set_y_scale(300); // height
          console.log(`[ProjectDetail] Created Video element:`, {
            name: element.name,
            VideoPath: element.VideoPath,
            toJSON: element.toJSON()
          });
          // Phase 6b (B1): granular create (captures id + notifies peers) then save.
          await this.addElementCollab(element, this.selectedGridIndex);
          this.socketService.emitElementUpdate(element, this.project!.name, this.project!.grid[this.selectedGridIndex].name);
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

  /**
   * N7: when a repeating task is just completed, append its next occurrence to the
   * owning ToDoLst so the cadence continues. Pure model logic lives on the task
   * (build_next_occurrence); this only decides where to add the new row. No-op for
   * one-off tasks or when the task was re-opened (not completed).
   */
  private spawnRecurrenceIfNeeded(task: scheduled_task, list: ToDoLst | null): void {
    if (!list || !task.is_done) return;
    const next = task.build_next_occurrence();
    if (next) list.add_task(next);
  }

  /** Find the ToDoLst in the current project that contains the given task, if any. */
  private findListContainingTask(task: scheduled_task): ToDoLst | null {
    if (!this.project) return null;
    for (const grid of this.project.grid) {
      for (const element of grid.Screen_elements) {
        if (this.getElementType(element) === 'ToDoLst') {
          const list = element as ToDoLst;
          if (list.scheduled_tasks.includes(task)) return list;
        }
      }
    }
    return null;
  }

  async onTaskToggle(task: any): Promise<void> {
    if (task.get_status()) {
      task.mark_incomplete();
    } else {
      const username = this.currentUser?.name || 'Unknown User';
      task.mark_complete(username);
      this.spawnRecurrenceIfNeeded(task, this.findListContainingTask(task));
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
    if (objects_builder.isTextDocument(element)) {
      this.isEditingText = true;
      this.editingTextIndex = elementIndex;
      this.editingTextContent = element.get_field() || '';
    }
  }

  async saveTextEdit(): Promise<void> {
    if (!this.project || this.editingTextIndex === -1) return;

    const element = this.project.grid[this.selectedGridIndex].Screen_elements[this.editingTextIndex];
    if (element && objects_builder.isTextDocument(element)) {
      element.set_field(this.editingTextContent);
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
    if (objects_builder.isTextDocument(element)) {
      return element.get_field() || '';
    }
    return '';
  }

  async deleteElement(elementIndex: number): Promise<void> {
    if (this.project && this.selectedGridIndex >= 0 && this.project.grid[this.selectedGridIndex].Screen_elements[elementIndex]) {
      const element = this.project.grid[this.selectedGridIndex].Screen_elements[elementIndex];
      this.elementToDelete = { index: elementIndex, element };
      this.confirmMessage = `Are you sure you want to delete the element "${element.name}"?`;
      this.modals.open('confirm');
    }
  }

  getElementType(element: Screen_Element): string {
    // Single canonical detector (shared model) — prefers the explicit `type`
    // discriminator now set on every element (survives minification, unlike the
    // old constructor.name check), falling back to shape detection.
    return objects_builder.typeOf(element);
  }

  getTodoTasks(element: Screen_Element): scheduled_task[] {
    if (objects_builder.isToDoLst(element)) {
      return element.scheduled_tasks || [];
    }
    return [];
  }

  getImagePath(element: Screen_Element): SafeUrl {
    if (objects_builder.isImage(element)) {
      const path = element.imagepath || '';
      return this.sanitizer.bypassSecurityTrustUrl(path);
    }
    return this.sanitizer.bypassSecurityTrustUrl('');
  }

  getVideoPath(element: Screen_Element): SafeUrl {
    if (objects_builder.isVideo(element)) {
      const path = element.VideoPath || '';
      return this.sanitizer.bypassSecurityTrustUrl(path);
    }
    return this.sanitizer.bypassSecurityTrustUrl('');
  }


  /**
   * Quick-add a task to a ToDoLst directly on the canvas (no modal — mirrors the
   * immediate-create add-element flow). Drops in a default-named, medium-priority
   * task and saves; the user renames it / sets priority / date / repeat in the
   * fullscreen todo view (double-click the list). Default priority 2 = Medium.
   */
  async addTaskToTodoList(elementIndex: number): Promise<void> {
    if (!this.project || this.selectedGridIndex < 0) return;

    const element = this.project.grid[this.selectedGridIndex].Screen_elements[elementIndex];
    if (!objects_builder.isToDoLst(element)) return;

    const task = new scheduled_task('New task', 2, new Date().toISOString());
    element.add_task(task);

    // Track save timestamp for the hosted reload-skip, then persist + reload.
    this.lastSaveTimestamp = Date.now();
    await this.dataService.saveProject(this.project, (this.project as any).projectType || 'local');
    this.loadProject();
    this.cdr.detectChanges();
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
    if (this.drag.isDraggingEnabled || this.justFinishedDragging) {
      this.justFinishedDragging = false;
      return;
    }

    if (!this.project || this.selectedGridIndex < 0) return;

    const element = this.project.grid[this.selectedGridIndex].Screen_elements[elementIndex];
    if (element && this.getElementType(element) === 'ToDoLst') {
      this.fullScreenTodoElement = element as ToDoLst;
      this.fullScreenTodoElementIndex = elementIndex;
      this.fullScreenTodoGridIndex = this.selectedGridIndex;
      this.modals.open('fullScreenTodo');
    }
  }

  closeFullScreenTodo(): void {
    this.modals.close('fullScreenTodo');
    this.fullScreenTodoElement = null;
    this.fullScreenTodoElementIndex = -1;
    this.fullScreenTodoGridIndex = -1;
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

    // Don't start drag if clicking on buttons or resize handles
    if (target.tagName === 'BUTTON' || target.closest('button') || target.closest('.resize-handle')) {
      return;
    }

    if (!card) return;

    // In link-pick mode, let the (click) handler pick the target — no select/drag.
    if (this.linkSourceId) {
      return;
    }

    // G2: Shift+click toggles this element in the multi-selection (no drag).
    if (event.shiftKey) {
      event.preventDefault();
      this.toggleSelectIndex(index);
      return;
    }

    // G2: a plain mousedown on an element outside the current multi-selection
    // collapses the selection to just this element (so single drags feel normal).
    const sel = this.selectedIndices();
    if (!sel.has(index)) {
      this.selectedIndices.set(new Set([index]));
    }
    this.selectedElementIndex = index;

    // Show visual feedback immediately that long-press is starting
    this.drag.longPressTargetIndex = index;

    // Start long-press timer for dragging (300ms)
    this.drag.longPressTimer = setTimeout(() => {
      this.drag.longPressTargetIndex = -1;
      this.drag.isDraggingEnabled = true;
      const rect = card.getBoundingClientRect();
      this.drag.elementDragOffsetX = event.clientX - rect.left;
      this.drag.elementDragOffsetY = event.clientY - rect.top;
      this.drag.draggedElementIndex = index;
      this.drag.draggedElementGridIndex = this.selectedGridIndex;
      this.drag.draggedElement = card;

      // G2: snapshot start positions for a group move.
      this.drag.groupDragStart = this.captureGroupStart(this.selectedGridIndex);

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

  this.drag.longPressTargetIndex = elementIndex;

  this.drag.longPressTimer = setTimeout(() => {
    this.drag.longPressTargetIndex = -1;
    this.drag.isDraggingEnabled = true;
    const rect = card.getBoundingClientRect();
    this.drag.elementDragOffsetX = touch.clientX - rect.left;
    this.drag.elementDragOffsetY = touch.clientY - rect.top;
    this.drag.draggedElementIndex = elementIndex;
    this.drag.draggedElement = card;
    card.style.cursor = 'grabbing';
  }, 300);
}

  onDocumentMouseMove(event: MouseEvent): void {
    // Phase 6b: broadcast local cursor position (throttled ~50ms) whenever the
    // pointer is over the canvas — independent of dragging state.
    this.emitCursor(event);

    // G2: update the selection marquee while shift-dragging empty canvas.
    if (this.isMarqueeSelecting) {
      const canvas = document.querySelector('.canvas-container') as HTMLElement;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const cx = this.viewport.toCanvasX(event.clientX, rect.left);
        const cy = this.viewport.toCanvasY(event.clientY, rect.top);
        this.marquee.set({
          x: Math.min(this.marqueeStartX, cx),
          y: Math.min(this.marqueeStartY, cy),
          w: Math.abs(cx - this.marqueeStartX),
          h: Math.abs(cy - this.marqueeStartY)
        });
        this.cdr.detectChanges();
      }
      return;
    }

    // Empty-canvas panning (isPanning set by onCanvasMouseDown).
    if (this.viewport.isPanning) {
      this.viewport.updatePan(event.clientX, event.clientY);
      this.cdr.detectChanges();
      return;
    }

    if (!this.drag.isDraggingEnabled || this.drag.draggedElement === null || !this.project) return;

    // Prefer the legacy pixel-based grid container when present; otherwise drive
    // the canvas (grid-unit) model so long-press drag works on the canvas surface.
    const legacyGrid = document.querySelector('.elements-grid') as HTMLElement;
    if (legacyGrid) {
      const containerRect = legacyGrid.getBoundingClientRect();
      const elementRect = this.drag.draggedElement.getBoundingClientRect();
      let x = event.clientX - containerRect.left - this.drag.elementDragOffsetX;
      let y = event.clientY - containerRect.top - this.drag.elementDragOffsetY;
      const containerPadding = 20; // From CSS padding
      const maxX = legacyGrid.clientWidth - elementRect.width - containerPadding;
      const maxY = legacyGrid.clientHeight - elementRect.height - containerPadding;
      x = Math.max(0, Math.min(x, maxX));
      y = Math.max(0, Math.min(y, maxY));
      this.drag.draggedElement.style.position = 'absolute';
      this.drag.draggedElement.style.left = x + 'px';
      this.drag.draggedElement.style.top = y + 'px';
      this.drag.draggedElement.style.zIndex = '1000';
      return;
    }

    // Canvas (grid-unit) drag path with group-move support.
    const canvas = document.querySelector('.canvas-container') as HTMLElement;
    if (!canvas || this.drag.draggedElementIndex < 0) return;
    const gridIdx = this.drag.draggedElementGridIndex >= 0 ? this.drag.draggedElementGridIndex : this.selectedGridIndex;
    if (!this.project.grid[gridIdx]) return;
    const gridEls = this.project.grid[gridIdx].Screen_elements;
    const leader = gridEls[this.drag.draggedElementIndex];
    if (!leader) return;

    const rect = canvas.getBoundingClientRect();
    const px = this.viewport.toCanvasX(event.clientX, rect.left, this.drag.elementDragOffsetX);
    const py = this.viewport.toCanvasY(event.clientY, rect.top, this.drag.elementDragOffsetY);
    const newXPos = Math.max(0, px) / this.GRID_PX_X;
    const newYPos = Math.max(0, py) / this.GRID_PX_Y;

    const start = this.drag.groupDragStart;
    const selected = this.selectedIndices();
    if (start && selected.size > 1 && start.has(this.drag.draggedElementIndex)) {
      // G2: group move — apply the leader's delta to every selected element.
      const leaderStart = start.get(this.drag.draggedElementIndex)!;
      const dx = newXPos - leaderStart.x;
      const dy = newYPos - leaderStart.y;
      start.forEach((pos, idx) => {
        const el = gridEls[idx];
        if (!el) return;
        this.setElementPos(el, Math.max(0, pos.x + dx), Math.max(0, pos.y + dy));
        this.emitElementMove(el);
      });
    } else {
      this.setElementPos(leader, newXPos, newYPos);
      this.emitElementMove(leader);
    }
    this.dataService.updateCurrentUser();
    this.cdr.detectChanges();
  }

  onDocumentTouchMove(event: TouchEvent): void {
  if (this.viewport.isPanning) {
    event.preventDefault();
    const touch = event.touches[0];
    this.viewport.updatePan(touch.clientX, touch.clientY);
    return;
  }

  if (this.drag.isDraggingEnabled && this.drag.draggedElement !== null && this.project) {
    event.preventDefault();
    const touch = event.touches[0];
    const container = document.querySelector('.elements-grid') as HTMLElement;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = this.drag.draggedElement.getBoundingClientRect();

    let x = touch.clientX - containerRect.left - this.drag.elementDragOffsetX;
    let y = touch.clientY - containerRect.top - this.drag.elementDragOffsetY;

    const containerPadding = 20;
    const maxX = container.clientWidth - elementRect.width - containerPadding;
    const maxY = container.clientHeight - elementRect.height - containerPadding;

    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));

    this.drag.draggedElement.style.position = 'absolute';
    this.drag.draggedElement.style.left = x + 'px';
    this.drag.draggedElement.style.top = y + 'px';
    this.drag.draggedElement.style.zIndex = '1000';
  }
}

  async onDocumentMouseUp(event: MouseEvent): Promise<void> {
    this.drag.cancelLongPress();

    // G2: conclude a marquee selection (shift+drag on empty canvas).
    if (this.isMarqueeSelecting) {
      const box = this.marquee();
      this.isMarqueeSelecting = false;
      this.marquee.set(null);
      if (box && (box.w > 2 || box.h > 2)) this.applyMarqueeSelection(box);
      this.cdr.detectChanges();
      return;
    }

    // End empty-canvas panning.
    if (this.viewport.isPanning) {
      this.viewport.endPan();
      this.cdr.detectChanges();
      return;
    }

    if (!this.drag.isDraggingEnabled) {
      return;
    }

    if (this.drag.draggedElement === null || !this.project) {
      this.drag.isDraggingEnabled = false;
      this.drag.groupDragStart = null;
      return;
    }

    // Legacy pixel-based grid container (kept for backwards compatibility).
    const legacyGrid = document.querySelector('.elements-grid') as HTMLElement;
    if (legacyGrid) {
      const containerRect = legacyGrid.getBoundingClientRect();
      const elementRect = this.drag.draggedElement.getBoundingClientRect();
      let x = event.clientX - containerRect.left - this.drag.elementDragOffsetX;
      let y = event.clientY - containerRect.top - this.drag.elementDragOffsetY;
      const containerPadding = 20;
      const maxX = legacyGrid.clientWidth - elementRect.width - containerPadding;
      const maxY = legacyGrid.clientHeight - elementRect.height - containerPadding;
      x = Math.max(0, Math.min(x, maxX));
      y = Math.max(0, Math.min(y, maxY));
      const element = this.project.grid[this.selectedGridIndex].Screen_elements[this.drag.draggedElementIndex];
      if (element) {
        this.setElementPos(element, x, y);
        this.emitElementMove(element, false);
        const projectType = (this.project as any).projectType;
        if (projectType) await this.dataService.saveProject(this.project, projectType);
      }
    } else {
      // Canvas (grid-unit) drop: snap each moved element and save once.
      const gridIdx = this.drag.draggedElementGridIndex >= 0 ? this.drag.draggedElementGridIndex : this.selectedGridIndex;
      const gridEls = this.project.grid[gridIdx]?.Screen_elements;
      if (gridEls) {
        const start = this.drag.groupDragStart;
        const selected = this.selectedIndices();
        const movedIndices: number[] =
          (start && selected.size > 1 && start.has(this.drag.draggedElementIndex))
            ? Array.from(start.keys())
            : [this.drag.draggedElementIndex];

        for (const idx of movedIndices) {
          const el = gridEls[idx];
          if (!el) continue;
          if (this.snapEnabled()) this.snapElementToGrid(el);
          // Phase 6b: final (un-throttled) move broadcast per moved element.
          this.emitElementMove(el, false);
        }
        this.dataService.updateCurrentUser();
        const projectType = (this.project as any).projectType;
        if (projectType) await this.dataService.saveProject(this.project, projectType);
      }
    }

    this.drag.draggedElement.style.cursor = 'grab';

    this.drag.draggedElement = null;
    this.drag.draggedElementIndex = -1;
    this.drag.isDraggingEnabled = false;
    this.drag.groupDragStart = null;
    this.justFinishedDragging = true;

    // Reset flag after a short delay to allow click event
    setTimeout(() => {
      this.justFinishedDragging = false;
    }, 100);
  }

  async onDocumentTouchEnd(event: TouchEvent): Promise<void> {
  this.drag.cancelLongPress();

  if (this.viewport.isPanning) {
    this.viewport.endPan();
    return;
  }

  if (!this.drag.isDraggingEnabled) {
    return;
  }

  if (this.drag.draggedElement === null || !this.project) {
    this.drag.isDraggingEnabled = false;
    return;
  }

  const container = document.querySelector('.elements-grid') as HTMLElement;
  if (!container) {
    this.drag.isDraggingEnabled = false;
    return;
  }

  const touch = event.changedTouches[0];
  const containerRect = container.getBoundingClientRect();
  const elementRect = this.drag.draggedElement.getBoundingClientRect();

  let x = touch.clientX - containerRect.left - this.drag.elementDragOffsetX;
  let y = touch.clientY - containerRect.top - this.drag.elementDragOffsetY;

  const containerPadding = 20;
  const maxX = container.clientWidth - elementRect.width - containerPadding;
  const maxY = container.clientHeight - elementRect.height - containerPadding;

  x = Math.max(0, Math.min(x, maxX));
  y = Math.max(0, Math.min(y, maxY));

  const element = this.project.grid[this.selectedGridIndex].Screen_elements[this.drag.draggedElementIndex];
  if (element) {
    this.setElementPos(element, x, y);

    const projectType = (this.project as any).projectType;
    if (projectType) {
      await this.dataService.saveProject(this.project, projectType);
    }
  }

  this.drag.draggedElement.style.cursor = 'grab';
  this.drag.draggedElement = null;
  this.drag.draggedElementIndex = -1;
  this.drag.isDraggingEnabled = false;
  this.justFinishedDragging = true;

  setTimeout(() => {
    this.justFinishedDragging = false;
  }, 100);
}

  onElementMouseLeave(): void {
    // Only cancel a pending long-press; don't stop an in-progress drag on leave.
    if (!this.drag.isDraggingEnabled) {
      this.drag.cancelLongPress();
    }
  }

  getElementStyle(element: Screen_Element): any {
    // Handle both class instances and plain objects
    const xpos = this.elXpos(element);
    const ypos = this.elYpos(element);
    let xscale = this.elXscale(element, 200);
    let yscale = this.elYscale(element, 100);

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

    // G2: Shift+drag on empty canvas draws a selection marquee instead of panning.
    if (event.shiftKey) {
      const container = document.querySelector('.canvas-container') as HTMLElement;
      if (container) {
        const rect = container.getBoundingClientRect();
        // Convert to canvas-content space (undo pan/zoom) so it matches element coords.
        const x = this.viewport.toCanvasX(event.clientX, rect.left);
        const y = this.viewport.toCanvasY(event.clientY, rect.top);
        this.isMarqueeSelecting = true;
        this.marqueeStartX = x;
        this.marqueeStartY = y;
        this.marquee.set({ x, y, w: 0, h: 0 });
        this.cdr.detectChanges();
        return;
      }
    }

    this.viewport.beginPan(event.clientX, event.clientY);
  }

  // NOTE: the old onCanvasMouseMove/onCanvasMouseUp handlers were never wired
  // (no template binding, not among the registered document listeners — the
  // live handlers are onDocumentMouseMove/onDocumentMouseUp). They were dead
  // duplicates of the marquee/pan/drag logic and have been removed. As a side
  // effect element *resize* has no live move handler — see startResize below.

  /** G2: set an element's grid-unit position (x_pos/y_pos), via setters when present. */
  private setElementPos(element: Screen_Element, xPos: number, yPos: number): void {
    const e = element as any;
    if (typeof e.set_xpos === 'function') {
      e.set_xpos(xPos);
      e.set_ypos(yPos);
    } else {
      e.x_pos = xPos;
      e.y_pos = yPos;
    }
  }

  // Geometry accessors that read via the model's getters when the element is a
  // class instance, and fall back to the raw field for plain (un-rebuilt)
  // objects. Centralized here so the getter-or-field `as any` dance lives in one
  // place instead of being duplicated across every canvas/drag/layout method.
  private elXpos(element: Screen_Element): number {
    const e = element as any;
    return typeof e.get_xpos === 'function' ? e.get_xpos() : (e.x_pos || 0);
  }
  private elYpos(element: Screen_Element): number {
    const e = element as any;
    return typeof e.get_ypos === 'function' ? e.get_ypos() : (e.y_pos || 0);
  }
  private elXscale(element: Screen_Element, fallback: number): number {
    const e = element as any;
    return typeof e.get_x_scale === 'function' ? e.get_x_scale() : (e.x_scale || fallback);
  }
  private elYscale(element: Screen_Element, fallback: number): number {
    const e = element as any;
    return typeof e.get_y_scale === 'function' ? e.get_y_scale() : (e.y_scale || fallback);
  }

  onCanvasWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      this.viewport.wheelZoom(event.deltaY);
    }
  }

  startResize(event: MouseEvent, element: Screen_Element, gridIndex: number, elementIndex: number, handle: string): void {
    event.stopPropagation();
    const startWidth = this.elXscale(element, 200);
    const startHeight = this.elYscale(element, 100);
    this.drag.beginResize(element, elementIndex, gridIndex, handle, event.clientX, event.clientY, startWidth, startHeight);
  }

  // Zoom / reset / grid-toggle now live on `viewport` (CanvasViewportService);
  // the toolbar binds to viewport.zoomIn/zoomOut/reset/toggleGrid directly.
  // Fit-to-screen stays here because it reads project elements + DOM sizing,
  // then hands the bounding box to the viewport to compute pan/zoom.
  canvasFitToScreen(): void {
    if (!this.project || this.project.grid.length === 0 || !this.project.grid[this.selectedGridIndex]) {
      this.viewport.reset();
      return;
    }

    const elements = this.project.grid[this.selectedGridIndex].Screen_elements;
    if (elements.length === 0) {
      this.viewport.reset();
      return;
    }

    // Calculate the content bounding box (screen px) for the viewport to fit.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
      const x = el.x_pos || 0;
      const y = el.y_pos || 0;
      const w = this.getElementWidth(el);
      const h = 150; // Default height
      minX = Math.min(minX, x * 250);
      minY = Math.min(minY, y * 200);
      maxX = Math.max(maxX, x * 250 + w);
      maxY = Math.max(maxY, y * 200 + h);
    }

    // Approximate container size (matches the previous inline constants).
    this.viewport.fitToBounds(minX, minY, maxX, maxY, 800, 600);
  }

  getElementWidth(element: Screen_Element): number {
    const xscale = this.elXscale(element, 1);
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
    const x = element.x_pos || 0;
    return x * 250 || index * 280;
  }

  getElementY(element: Screen_Element, index: number): number {
    const y = element.y_pos || 0;
    return y * 200 || index * 180;
  }

  onCanvasClick(event: MouseEvent): void {
    // Deselect element when clicking on empty canvas
    if (!(event.target as HTMLElement).closest('.canvas-element')) {
      // Don't clear if this click concludes a shift+drag marquee.
      if (event.shiftKey) return;
      this.selectedElementIndex = -1;
      // G2: also clear the multi-selection set.
      if (this.selectedIndices().size > 0) {
        this.selectedIndices.set(new Set<number>());
        this.cdr.detectChanges();
      }
    }
    // G2: any canvas click closes the templates menu.
    if (this.showTemplatesMenu()) {
      this.showTemplatesMenu.set(false);
      this.cdr.detectChanges();
    }
  }

  onElementDoubleClick(element: Screen_Element, index: number): void {
    // Open todo list in full screen on double click
    if (this.getElementType(element) === 'ToDoLst') {
      this.openFullScreenTodo(index);
    } else if (this.getElementType(element) === 'Text_document') {
      // B3: open the collaborative rich-text editor.
      this.openTextEditor(element as Text_document);
    }
  }

  /** B3: open the collaborative Yjs editor for a Text_document element. */
  openTextEditor(element: Text_document): void {
    this.textEditorElement = element;
    this.modals.open('textEditor');
    this.cdr.detectChanges();
  }

  /** Close the collaborative editor. The overlay has already mirrored its final
   *  state onto the element; persist a whole-project snapshot for durability. */
  async closeTextEditor(): Promise<void> {
    this.modals.close('textEditor');
    this.textEditorElement = null;
    this.cdr.detectChanges();
    if (this.project) {
      const projectType = (this.project as any).projectType;
      if (projectType) {
        try {
          await this.dataService.saveProject(this.project, projectType);
        } catch (e) {
          console.warn('[ProjectDetail] closeTextEditor save failed:', e);
        }
      }
    }
  }

  deleteSelected(): void {
    if (this.selectedElementIndex >= 0 && this.project) {
      this.deleteElement(this.selectedElementIndex);
    }
  }

  // =========================================================================
  // G2: multi-select / group-move / grid-snap / templates helpers
  // =========================================================================

  /** True when the given element index is part of the multi-selection. */
  isIndexSelected(index: number): boolean {
    return this.selectedIndices().has(index);
  }

  /** Toggle a single element index in the multi-selection set. */
  toggleSelectIndex(index: number): void {
    const next = new Set(this.selectedIndices());
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    this.selectedIndices.set(next);
    // Keep the legacy single-selection index in sync for existing UI (delete btn, etc.).
    this.selectedElementIndex = next.size === 1 ? Array.from(next)[0] : (next.has(index) ? index : -1);
    this.cdr.detectChanges();
  }

  /** Snapshot each selected element's current grid-unit position, keyed by index. */
  private captureGroupStart(gridIndex: number): Map<number, { x: number; y: number }> {
    const snap = new Map<number, { x: number; y: number }>();
    if (!this.project || !this.project.grid[gridIndex]) return snap;
    const els = this.project.grid[gridIndex].Screen_elements;
    this.selectedIndices().forEach(idx => {
      const el = els[idx] as any;
      if (el) snap.set(idx, { x: el.x_pos ?? 0, y: el.y_pos ?? 0 });
    });
    // Ensure the leader is always represented even if selection was empty.
    if (!snap.has(this.drag.draggedElementIndex)) {
      const el = els[this.drag.draggedElementIndex] as any;
      if (el) snap.set(this.drag.draggedElementIndex, { x: el.x_pos ?? 0, y: el.y_pos ?? 0 });
    }
    return snap;
  }

  /** Snap an element's x_pos/y_pos to the nearest 0.5 grid unit. */
  private snapElementToGrid(element: Screen_Element): void {
    const el = element as any;
    const x = el.x_pos ?? 0;
    const y = el.y_pos ?? 0;
    const snapped = (v: number) => Math.round(v / this.SNAP_UNIT) * this.SNAP_UNIT;
    this.setElementPos(element, Math.max(0, snapped(x)), Math.max(0, snapped(y)));
  }

  /** Toolbar toggle for drop-time grid snapping. */
  toggleSnap(): void {
    this.snapEnabled.set(!this.snapEnabled());
    this.cdr.detectChanges();
  }

  /**
   * Select every element whose rendered box intersects the marquee rectangle
   * (canvas-content coords). Widths come from getElementWidth; heights fall back
   * to a sensible default when the element has no explicit scale.
   */
  private applyMarqueeSelection(box: { x: number; y: number; w: number; h: number }): void {
    const els = this.getElements();
    const next = new Set<number>();
    els.forEach((el, i) => {
      const ex = this.getElementX(el, i);
      const ey = this.getElementY(el, i);
      const ew = this.getElementWidth(el);
      const yscale = (el as any).y_scale;
      const eh = yscale && yscale > 10 ? yscale : 120;
      const intersects =
        ex < box.x + box.w && ex + ew > box.x &&
        ey < box.y + box.h && ey + eh > box.y;
      if (intersects) next.add(i);
    });
    this.selectedIndices.set(next);
    this.selectedElementIndex = next.size === 1 ? Array.from(next)[0] : -1;
  }

  /** Ctrl/Cmd+A → select every element in the current grid. */
  selectAllElements(): void {
    const count = this.getElements().length;
    const next = new Set<number>();
    for (let i = 0; i < count; i++) next.add(i);
    this.selectedIndices.set(next);
    this.selectedElementIndex = count === 1 ? 0 : -1;
    this.cdr.detectChanges();
  }

  /** Esc → clear the multi-selection (and any link/marquee/templates state). */
  clearSelection(): void {
    if (this.selectedIndices().size > 0) this.selectedIndices.set(new Set<number>());
    this.selectedElementIndex = -1;
    this.cdr.detectChanges();
  }

  /**
   * Delete every selected element. Reuses the existing per-element delete path
   * (removeElementFromGrid + granular delete broadcast). Deletes high-index-first
   * so earlier indices stay valid during removal.
   */
  async deleteSelectedElements(): Promise<void> {
    if (!this.project || this.selectedGridIndex < 0) return;
    const indices = Array.from(this.selectedIndices()).sort((a, b) => b - a);
    if (indices.length === 0) return;

    const grid = this.project.grid[this.selectedGridIndex];
    if (!grid) return;

    for (const idx of indices) {
      const element = grid.Screen_elements[idx];
      if (!element) continue;
      try {
        await this.dataService.removeElementFromGrid(this.projectIndex, this.selectedGridIndex, idx);
        this.emitElementDelete(element);
      } catch (e) {
        console.error('[ProjectDetail] deleteSelectedElements error at index', idx, e);
      }
    }

    this.selectedIndices.set(new Set<number>());
    this.selectedElementIndex = -1;
    this.loadProject();
    this.cdr.detectChanges();
  }

  /** Global keydown handler for canvas shortcuts. SSR-safe (only wired in browser). */
  private onDocumentKeyDown(event: KeyboardEvent): void {
    // Ignore when typing in a field or any modal/overlay is open.
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
    if (this.modals.anyOpen('fullScreenTodo', 'elementTypeSelector', 'error',
        'confirm', 'createGrid')) return;
    if (!this.project) return;

    // Ctrl/Cmd+A → select all.
    if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      this.selectAllElements();
      return;
    }
    // Esc → clear selection / cancel link/marquee.
    if (event.key === 'Escape') {
      if (this.linkSourceId) { this.cancelLinkMode(); return; }
      if (this.showTemplatesMenu()) { this.showTemplatesMenu.set(false); this.cdr.detectChanges(); return; }
      this.clearSelection();
      return;
    }
    // Delete / Backspace → delete all selected elements.
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedIndices().size > 0) {
        event.preventDefault();
        this.deleteSelectedElements();
      }
      return;
    }
  }

  // ---- Templates: insert preset element groups via existing creation logic ----

  toggleTemplatesMenu(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.showTemplatesMenu.set(!this.showTemplatesMenu());
    this.cdr.detectChanges();
  }

  /** "Kanban" preset: three ToDoLst columns (To Do / Doing / Done) side by side. */
  async insertKanbanTemplate(): Promise<void> {
    this.showTemplatesMenu.set(false);
    if (!this.project || this.selectedGridIndex < 0) return;
    const cols = ['To Do', 'Doing', 'Done'];
    // Spread across grid units (0.5 apart in the ×250 space keeps them adjacent).
    const created: Screen_Element[] = [];
    for (let c = 0; c < cols.length; c++) {
      const el = new ToDoLst(cols[c], c, 0);
      el.x_scale = 280;
      el.y_scale = 200;
      await this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, el);
      created.push(el);
    }
    await this.persistTemplate(created);
  }

  /** "Note + Tasks" preset: one Text_document + one ToDoLst with 3 starter tasks. */
  async insertNoteTasksTemplate(): Promise<void> {
    this.showTemplatesMenu.set(false);
    if (!this.project || this.selectedGridIndex < 0) return;

    const note = new Text_document('Notes', 0, 0, 'Jot your notes here…');
    note.x_scale = 300;
    note.y_scale = 220;
    await this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, note);

    const tasks = new ToDoLst('Tasks', 1, 0);
    tasks.x_scale = 280;
    tasks.y_scale = 220;
    ['First task', 'Second task', 'Third task'].forEach((name, i) => {
      tasks.add_task(new scheduled_task(name, i === 0 ? 1 : 2, new Date().toISOString()));
    });
    await this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, tasks);

    await this.persistTemplate([note, tasks]);
  }

  /** Shared save + collab-broadcast path for a freshly inserted template. */
  private async persistTemplate(created: Screen_Element[]): Promise<void> {
    if (!this.project) return;
    const projectType = (this.project as any).projectType || this.project.project_type;
    // Phase 6b (B1): granular create each new element FIRST so we capture its
    // authoritative id (and peers get it live); the whole-project save below
    // then reuses those ids, collapsing the granular rows in place rather than
    // leaving duplicates.
    for (const el of created) await this.emitElementCreate(el, this.selectedGridIndex);
    if (projectType) {
      this.lastSaveTimestamp = Date.now();
      await this.dataService.saveProject(this.project, projectType);
    }
    this.loadProject();
    this.cdr.detectChanges();
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
    this.viewport.beginPan(touch.clientX, touch.clientY);
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
  // =========================================================================
  // B2: presence + cursor color palette (hash username -> accent spectrum)
  // =========================================================================

  /** Deterministically map a username to one of the album accent colors. */
  getUserColor(username: string): string {
    return userColor(username);
  }

  // =========================================================================
  // A2: dependency links on the canvas
  // =========================================================================

  /** All ToDoLst elements in the current grid (with their index). */
  private getTodoElements(): { element: ToDoLst; index: number }[] {
    const out: { element: ToDoLst; index: number }[] = [];
    this.getElements().forEach((element, index) => {
      if (objects_builder.isToDoLst(element)) out.push({ element, index });
    });
    return out;
  }

  /** Center X of an element card (canvas-content coords). */
  getElementCenterX(element: Screen_Element, index: number): number {
    return this.getElementX(element, index) + this.getElementWidth(element) / 2;
  }

  /** Center Y of an element card (canvas-content coords). */
  getElementCenterY(element: Screen_Element, index: number): number {
    const yscale = element.y_scale;
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
      const dependsOn = element.dependsOn;
      if (!Array.isArray(dependsOn) || dependsOn.length === 0) continue;
      const sx = this.getElementCenterX(element, index);
      const sy = this.getElementCenterY(element, index);
      for (const targetId of dependsOn) {
        const target = todos.find(t => t.element.id === targetId);
        if (!target) continue;
        const tx = this.getElementCenterX(target.element, target.index);
        const ty = this.getElementCenterY(target.element, target.index);
        links.push({
          x1: tx, y1: ty, x2: sx, y2: sy,
          blocked: !this.isElementComplete(target.element),
          key: `${element.id}->${targetId}`
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
    if (!objects_builder.isToDoLst(element)) return false;
    const dependsOn = element.dependsOn;
    if (!Array.isArray(dependsOn) || dependsOn.length === 0) return false;
    const todos = this.getTodoElements();
    return dependsOn.some(id => {
      const target = todos.find(t => t.element.id === id);
      return target ? !this.isElementComplete(target.element) : false;
    });
  }

  /** Whether the "add dependency" affordance should be shown for an element. */
  canLinkElement(element: Screen_Element): boolean {
    return objects_builder.isToDoLst(element) && !!element.id;
  }

  /** Start "pick target" mode from the given source ToDoLst element. */
  startLinkMode(element: Screen_Element, event?: MouseEvent): void {
    if (event) event.stopPropagation();
    const id = element.id;
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
    const targetId = element.id;
    if (!targetId || targetId === this.linkSourceId) {
      this.cancelLinkMode();
      return;
    }
    const found = this.findElementById(this.linkSourceId);
    this.linkSourceId = null;
    if (!found || !objects_builder.isToDoLst(found.element)) return;

    const source = found.element;
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
    if (!this.project || !objects_builder.isToDoLst(element)) return;
    const source = element;
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
    if (!objects_builder.isToDoLst(element)) return [];
    const d = element.dependsOn;
    return Array.isArray(d) ? d : [];
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

    // Drop this project's chat channel from the shell panel.
    this.chatUi.setProjectChannel(null);

    // Remove every document-level listener we registered (drag/pan/keyboard).
    // Without this, each project visit leaked a permanent set of handlers.
    if (isPlatformBrowser(this.platformId)) {
      for (const { type, handler, opts } of this.documentListeners) {
        document.removeEventListener(type, handler, opts);
      }
    }
    this.documentListeners = [];

    // Clear any pending timeouts
    if (this.savingTimeout) {
      clearTimeout(this.savingTimeout);
    }
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }
    // A long-press drag timer can outlive the component if navigation happens
    // mid-press; clear it so it never fires against a destroyed instance.
    this.drag.cancelLongPress();
  }



}

