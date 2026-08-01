import { Component, OnInit, OnDestroy, ChangeDetectorRef, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { DataService } from '../../services/data.service';
import { SocketService } from '../../services/socket.service';
import { User } from '../../../../../shared_models/models/user.model';
import { Project, Grid } from '../../../../../shared_models/models/project.model';
import {
  Text_document,
  ToDoLst,
  scheduled_task,
} from '../../../../../shared_models/models/screen-elements.model';
import { isLocalhostServer } from '../../config/server.config';
import { ShareDialogComponent } from './share-dialog/share-dialog.component';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [FormsModule, RouterModule, NgClass, ShareDialogComponent],
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.css']
})
export class ProjectsComponent implements OnInit, OnDestroy {
  // Expose Math for template usage (progress bar capping)
  readonly Math = Math;

  currentUser: User | null = null;
  showCreateModal = false;
  newProjectName = '';
  projectType: 'local' | 'hosted' = 'local';

  // Local UI state — grid/list toggle (signal: zoneless-safe, no Zone.js required)
  viewMode = signal<'grid' | 'list'>('grid');

  // Error/Alert modal
  showErrorModal = false;
  errorMessage = '';

  // Confirmation modal
  showConfirmModal = false;
  confirmMessage = '';
  projectToDelete: { index: number; project: Project } | null = null;

  // Share dialog — reuses the same self-contained ShareDialogComponent that the
  // project-detail screen uses, so a hosted project can be shared straight from
  // the list without opening it first.
  showShareDialog = false;
  shareProject: Project | null = null;

  // Loading states
  isSaving = false;
  isDeleting = false;
  isLoading = false;
  isCreatingSample = false;
  deletingProjectIndex: number | null = null;
  private loadingTimeout: any = null;

  // Prevent infinite loops
  private isLoadingProjects = false;
  private hasLoadedProjects = false;
  private userSubscription: any;
  private hostedProjectUpdateSubscription: any;
  private hostedProjectDeleteSubscription: any;

  constructor(
    private dataService: DataService,
    private socketService: SocketService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) { }

  setViewMode(mode: 'grid' | 'list'): void {
    this.viewMode.set(mode);
  }

  /** Count of local projects in the combined list (used to gate empty state). */
  localCount(): number {
    return this.currentUser?.projects?.filter((p) => this.isLocalProject(p)).length ?? 0;
  }

  /** Count of hosted/shared projects in the combined list. */
  hostedCount(): number {
    return this.currentUser?.projects?.filter((p) => !this.isLocalProject(p)).length ?? 0;
  }

  /** Up-to-two-letter initials for a hosted project's owner avatar. */
  ownerInitials(project: Project): string {
    const name = project.owner_name ?? '';
    return (name || '?')
      .split(/\s+/)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  /** Close the create dialog only when the backdrop itself is clicked, and not mid-save. */
  onCreateScrim(event: MouseEvent): void {
    if (event.target === event.currentTarget && !this.isSaving) {
      this.closeCreateModal();
    }
  }

  ngOnInit(): void {
    // Reset loading flags when component initializes
    this.hasLoadedProjects = false;
    this.isLoadingProjects = false;
    this.isLoading = false; // Reset display loading state

    // Get initial user state
    const initialUser = this.dataService.getCurrentUser();
    if (initialUser) {
      this.currentUser = initialUser;
      // Load projects immediately if user is already set
      this.loadProjectsFromServer();
    }

    // Subscribe to user changes
    this.userSubscription = this.dataService.currentUser$.subscribe(async user => {
      const previous = this.currentUser;
      const previousUserName = previous?.name;

      // A5: DataService re-emits the current user several times during bootstrap
      // (loadUser → adoptBackendUser → createUserAsync), often as a FRESH object
      // with an empty `projects` array. Without this guard, reassigning
      // `this.currentUser` to that empty reference discards the projects we
      // already loaded onto the old one — the cards blank out into the empty
      // state even though the load succeeded. When the SAME user re-emits empty,
      // carry the already-loaded projects over to the new reference.
      if (
        user &&
        previous &&
        user !== previous &&
        user.name === previousUserName &&
        (user.projects?.length ?? 0) === 0 &&
        previous.projects.length > 0
      ) {
        user.projects.push(...previous.projects);
      }

      this.currentUser = user;

      // Only load projects if:
      // 1. User is set
      // 2. User actually changed (different user ID)
      // 3. Not already loading
      if (user && !this.isLoadingProjects && previousUserName !== user.name) {
        this.hasLoadedProjects = false;
        await this.loadProjectsFromServer();
      }
    });

    // Subscribe to loading states
    this.dataService.savingProject$.subscribe(loading => {
      this.isSaving = loading;
      console.log('Saving state changed:', loading);
      this.cdr.markForCheck();
    });

    this.dataService.deletingProject$.subscribe(loading => {
      this.isDeleting = loading;
      this.cdr.markForCheck();
    });

      this.hostedProjectUpdateSubscription = this.socketService.onHostedProjectUpdated().subscribe((data: any) => {
      console.log('[ProjectsComponent] Hosted project updated by another user, reloading projects list...');

      this.loadProjectsFromServer();
    });


    this.hostedProjectDeleteSubscription = this.socketService.onHostedProjectDeleted().subscribe((data: any) => {
      console.log('[ProjectsComponent] Hosted project deleted by another user, reloading projects list...');

      this.loadProjectsFromServer();
    });
  }

  ngOnDestroy(): void {

    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }


    this.isLoading = false;
    this.isLoadingProjects = false;

    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
    if (this.hostedProjectUpdateSubscription) {
      this.hostedProjectUpdateSubscription.unsubscribe();
    }
    if (this.hostedProjectDeleteSubscription) {
      this.hostedProjectDeleteSubscription.unsubscribe();
    }
  }

  async loadProjectsFromServer(): Promise<void> {
    if (!this.currentUser) {
      console.log('No current user, skipping load');
      return;
    }

    if (this.isLoadingProjects) {
      console.log('Already loading projects, skipping');
      return;
    }

    this.isLoadingProjects = true;
    this.isLoading = true;
    this.hasLoadedProjects = false;

     if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }
    this.loadingTimeout = setTimeout(() => {
      if (this.isLoading || this.isLoadingProjects) {
        console.warn('[ProjectsComponent] Force clearing stuck loading state after timeout');
        this.isLoading = false;
        this.isLoadingProjects = false;
        this.hasLoadedProjects = true;
        this.cdr.markForCheck();
      }
      this.loadingTimeout = null;
    }, 15000);

    try {
      console.log('Loading projects from server...');
      const isLocalhost = isLocalhostServer();
      console.log(`[ProjectsComponent] Server is localhost: ${isLocalhost}`);


      const loadPromises: Promise<Project[]>[] = [
        this.dataService.listProjects('hosted')
      ];

      if (isLocalhost) {
        loadPromises.push(this.dataService.listProjects('local'));
      }

      const results = await Promise.all(loadPromises);
      const hostedProjects = results[0];
      const localProjects = isLocalhost ? results[1] : [];

      console.log(`[ProjectsComponent] Local projects (only if localhost):`, localProjects.map(p => p.name));
      console.log(`[ProjectsComponent] Hosted projects:`, hostedProjects.map(p => p.name));
      const allProjects = [...localProjects, ...hostedProjects];
      console.log(`[ProjectsComponent] All projects:`, allProjects.map(p => ({ name: p.name, type: (p as any).projectType })));

      if (this.currentUser) {
        this.currentUser.projects.length = 0;
        this.currentUser.projects.push(...allProjects);
        console.log(`[ProjectsComponent] Final user projects:`, this.currentUser.projects.map(p => ({ name: p.name, type: (p as any).projectType })));
        this.hasLoadedProjects = true;
        this.cdr.markForCheck();
      }
    } catch (error) {
      console.error('Error loading projects from server:', error);
      this.hasLoadedProjects = false;
    } finally {
      if (this.loadingTimeout) {
        clearTimeout(this.loadingTimeout);
        this.loadingTimeout = null;
      }

      this.isLoadingProjects = false;
      this.isLoading = false;
      console.log('Loading projects completed');
      this.cdr.markForCheck();
    }
  }

  openCreateModal(): void {
    this.showCreateModal = true;
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
    this.newProjectName = '';
  }

  showError(message: string): void {
    this.errorMessage = message;
    this.showErrorModal = true;
  }

  closeErrorModal(): void {
    this.showErrorModal = false;
    this.errorMessage = '';
  }

  showConfirmation(message: string, index: number, project: Project): void {
    this.confirmMessage = message;
    this.projectToDelete = { index, project };
    this.showConfirmModal = true;
  }

  closeConfirmModal(): void {
    this.showConfirmModal = false;
    this.confirmMessage = '';
    this.projectToDelete = null;
  }

  async confirmDelete(): Promise<void> {
    if (!this.projectToDelete || !this.currentUser) {
      this.closeConfirmModal();
      return;
    }

    const { index, project } = this.projectToDelete;
    this.deletingProjectIndex = index;
    this.closeConfirmModal();

    const projectType = (project as any).projectType || 'local';
    const deleted = await this.dataService.deleteProject(project.name, projectType);
    this.deletingProjectIndex = null;

    if (deleted) {
      console.log('Project deleted successfully');
    } else {
      console.error('Failed to delete project from server');
      this.showError('Failed to delete project. Please try again.');
    }
  }

  async createProject(): Promise<void> {
    if (this.newProjectName.trim()) {
      const isLocalhost = isLocalhostServer();
      if (this.projectType === 'local' && !isLocalhost) {
        alert('Local projects can only be created when connected to a localhost server. Please switch to hosted projects or connect to localhost.');
        return;
      }


      const projectName = this.newProjectName.trim();
      const projectTypeValue = this.projectType;

      if (this.currentUser) {
        const existingProject = this.currentUser.projects.find(
          p => p.name === projectName
        );
        if (existingProject) {
          this.showError(`A project named "${projectName}" already exists. Please choose a different name.`);
          return;
        }
      }


      this.closeCreateModal();

      const newProject = this.dataService.createProject(projectName, projectTypeValue);

      if (newProject && this.currentUser) {

        // A16: mark this save as a CREATE so the server rejects a duplicate name
        // (from a stale client list or a race) instead of silently overwriting.
        const saved = await this.dataService.saveProject(newProject, projectTypeValue, true);
        if (saved) {
          console.log('Project created and saved successfully');

          await this.loadProjectsFromServer();
        } else {
          console.error('Failed to save project to server');
          // Roll back the optimistic local project and tell the user.
          this.dataService.removeLocalProject(newProject);
          this.showError(`Couldn't create "${projectName}". A project with that name may already exist, or the server is unreachable.`);
        }
      }
    }
  }


  /**
   * Build a ready-to-explore starter project in code (a single Grid with a
   * "Welcome" Text_document and a "Getting Started" ToDoLst holding a few
   * scheduled tasks at spread-out grid positions), then persist it via the
   * EXISTING dataService.saveProject path — no new Socket.IO events — and
   * navigate to it. Runs from the empty-state secondary CTA.
   */
  async createSampleProject(): Promise<void> {
    if (this.isCreatingSample || this.isSaving) {
      return;
    }
    if (!this.currentUser) {
      this.showError('Please sign in before creating a sample project.');
      return;
    }

    // Sample projects are hosted unless we're on a localhost server (where
    // local projects are supported), matching createProject()'s rules.
    const projectTypeValue: 'local' | 'hosted' = isLocalhostServer()
      ? 'local'
      : 'hosted';

    // Pick a non-colliding name.
    let sampleName = 'Sample Project';
    const existingNames = new Set(this.currentUser.projects.map((p) => p.name));
    if (existingNames.has(sampleName)) {
      let n = 2;
      while (existingNames.has(`Sample Project ${n}`)) {
        n++;
      }
      sampleName = `Sample Project ${n}`;
    }

    this.isCreatingSample = true;
    try {
      const project = new Project(
        sampleName,
        this.currentUser.name,
        projectTypeValue,
      );

      // Single starter grid/canvas.
      const grid = new Grid('Main Canvas');

      // Welcome note (Text_document) at the top-left of the canvas.
      const welcome = new Text_document(
        'Welcome',
        80,
        80,
        'Welcome to Clarity! This is a shared canvas. Drag elements around, add ' +
          'text, images, and to-do lists, and collaborate with your team in real time.',
      );

      // Getting Started to-do list (ToDoLst) placed to the right, with ~3
      // scheduled tasks due over the next few days.
      const gettingStarted = new ToDoLst('Getting Started', 520, 120);
      const day = 24 * 60 * 60 * 1000;
      const now = Date.now();
      gettingStarted.add_task(
        new scheduled_task(
          'Explore the canvas — pan, zoom, and select elements',
          1,
          new Date(now + day).toISOString(),
        ),
      );
      gettingStarted.add_task(
        new scheduled_task(
          'Add your first element from the palette',
          2,
          new Date(now + 2 * day).toISOString(),
        ),
      );
      gettingStarted.add_task(
        new scheduled_task(
          'Invite a teammate and collaborate live',
          3,
          new Date(now + 3 * day).toISOString(),
        ),
      );

      grid.add_element(welcome);
      grid.add_element(gettingStarted);
      project.grid.push(grid);

      // Persist through the same save path createProject() uses.
      const saved = await this.dataService.saveProject(
        project,
        projectTypeValue,
      );
      if (!saved) {
        this.showError('Failed to create the sample project. Please try again.');
        return;
      }

      // Refresh the list so indices line up, then open the new project.
      await this.loadProjectsFromServer();
      const index = this.currentUser.projects.findIndex(
        (p) => p.name === sampleName,
      );
      if (index !== -1) {
        this.selectProject(index);
      }
    } catch (error) {
      console.error('Error creating sample project:', error);
      this.showError('Failed to create the sample project. Please try again.');
    } finally {
      this.isCreatingSample = false;
      this.cdr.markForCheck();
    }
  }

  isLocalProjectsAvailable(): boolean {
    return isLocalhostServer();
  }

  isLocalProject(project: Project): boolean {
    return (project as any).isLocal !== false;
  }

  getTotalElements(project: Project): number {
    if (!project.grid || project.grid.length === 0) {
      return 0;
    }
    return project.grid.reduce((total, grid) => total + grid.Screen_elements.length, 0);
  }

  /** Returns one of 5 album-spectrum accent class names based on card index. */
  getCardAccentClass(index: number): string {
    const classes = [
      'cover-accent-cyan',
      'cover-accent-blue',
      'cover-accent-teal',
      'cover-accent-green',
      'cover-accent-lime',
    ];
    return classes[index % classes.length];
  }

  /** Returns one of 5 strip/icon accent class names based on card index. */
  getRowAccentClass(index: number): string {
    const classes = [
      'row-accent-cyan',
      'row-accent-blue',
      'row-accent-teal',
      'row-accent-green',
      'row-accent-lime',
    ];
    return classes[index % classes.length];
  }

  selectProject(index: number): void {
    this.router.navigate(['/dashboard/projects', index]);
  }

  /**
   * Whether the current user may CHANGE sharing for a project (owner/admin).
   * Mirrors project-detail's `canManageProject`, but falls back to an
   * owner-name match when the list payload doesn't carry an explicit role — so
   * a user can always share a hosted project they own from the list.
   */
  canManageProject(project: Project): boolean {
    const role = (project as any).role;
    if (role) return role === 'owner' || role === 'admin';
    return !!this.currentUser && project.owner_name === this.currentUser.name;
  }

  /** Open the share dialog for a hosted project from its card. */
  openShareDialog(index: number, event: Event): void {
    event.stopPropagation();
    if (this.currentUser && this.currentUser.projects[index]) {
      this.shareProject = this.currentUser.projects[index];
      this.showShareDialog = true;
    }
  }

  closeShareDialog(): void {
    this.showShareDialog = false;
    this.shareProject = null;
  }

  async deleteProject(index: number, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.currentUser && this.currentUser.projects[index]) {
      const project = this.currentUser.projects[index];
      this.showConfirmation('Are you sure you want to delete this project?', index, project);
    }
  }
}
