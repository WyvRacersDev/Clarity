import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { DataService } from '../../../services/data.service';
import { SocketService } from '../../../services/socket.service';
import { getServerConfig } from '../../../config/app.config';
import { User } from '../../../../../../shared_models/models/user.model';
import { Project, Grid } from '../../../../../../shared_models/models/project.model';
import { Screen_Element, ToDoLst, Text_document, Image, Video, scheduled_task } from '../../../../../../shared_models/models/screen_elements.model';

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
  newTaskPriority = 2;
  newTaskTime = '';
  taskColumnIndex = -1;
  taskElementIndex = -1;
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

  // Loading states
  isSaving = false;
  isLoading = false;
  private savingTimeout: any = null;
  private loadingTimeout: any = null;

  // Subscriptions
  private hostedProjectUpdateSubscription: any;
  private hostedProjectDeleteSubscription: any;
  private elementUpdateSubscription: any;

  constructor(
    private dataService: DataService,
    private socketService: SocketService,
    private route: ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
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

    // Global mouse move and up listeners for drag
    document.addEventListener('mousemove', (e) => this.onDocumentMouseMove(e));
    document.addEventListener('mouseup', (e) => this.onDocumentMouseUp(e));
    document.addEventListener('mousedown', (e) => this.onDocumentMouseDown(e));
    
    //TOUCH CONTROLS KIS NEI ADD KERNE THAY?????
    document.addEventListener('touchmove', (e) => this.onDocumentTouchMove(e), { passive: false });
    document.addEventListener('touchend', (e) => this.onDocumentTouchEnd(e));
    document.addEventListener('touchstart', (e) => this.onDocumentTouchStart(e));
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
    if (!this.project || this.project.grid.length === 0) {
      return;
    }
    this.showElementTypeSelector = true;
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
    if (!this.project || this.selectedGridIndex < 0) return;

    const element = new ToDoLst('Tasks', 200, 200);
    await this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
    this.loadProject(); // Reload to see the changes
    this.cdr.detectChanges();
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
    return element.constructor.name;
  }

  getTodoTasks(element: Screen_Element): any[] {
    if (element.constructor.name === 'ToDoLst') {
      return (element as any).scheduled_tasks || [];
    }
    return [];
  }

  getImagePath(element: Screen_Element): SafeUrl {
    if (element.constructor.name === 'Image') {
      const path = (element as any).imagepath || '';
      return this.sanitizer.bypassSecurityTrustUrl(path);
    }
    return this.sanitizer.bypassSecurityTrustUrl('');
  }

  getVideoPath(element: Screen_Element): SafeUrl {
    if (element.constructor.name === 'Video') {
      const path = (element as any).VideoPath || '';
      return this.sanitizer.bypassSecurityTrustUrl(path);
    }
    return this.sanitizer.bypassSecurityTrustUrl('');
  }


  addTaskToTodoList(elementIndex: number): void {
    if (!this.project || this.selectedGridIndex < 0) return;

    const element = this.project.grid[this.selectedGridIndex].Screen_elements[elementIndex];
    if (element && element.constructor.name === 'ToDoLst') {
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
    this.taskColumnIndex = -1;
    this.taskElementIndex = -1;
  }

  async submitAddTask(): Promise<void> {
    if (!this.project || this.taskColumnIndex === -1 || !this.newTaskName.trim()) return;

    let todoList: ToDoLst | null = null;

    // If we have a specific element index (from grid view), use that
    if (this.taskElementIndex >= 0 && this.project.grid[this.taskColumnIndex]) {
      const element = this.project.grid[this.taskColumnIndex].Screen_elements[this.taskElementIndex];
      if (element && element.constructor.name === 'ToDoLst') {
        todoList = element as ToDoLst;
      }
    }

    // Find the first todo list in the column if no specific element index
    if (!todoList && this.project.grid[this.taskColumnIndex]) {
      const element = this.project.grid[this.taskColumnIndex].Screen_elements.find(
        (el: Screen_Element) => el.constructor.name === 'ToDoLst'
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

    // Create new task
    const task = new scheduled_task(this.newTaskName.trim(), this.newTaskPriority, new Date().toISOString());
    todoList.add_task(task);
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
    if (element && element.constructor.name === 'ToDoLst') {
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

    const task = new scheduled_task(this.newTaskName.trim(), this.newTaskPriority, taskTime);
    this.fullScreenTodoElement.add_task(task);
    await this.saveFullScreenTodo();
    this.newTaskName = '';
    this.newTaskPriority = 2;
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

    await this.dataService.saveProject(this.project, (this.project as any).projectType || 'local');
    this.loadProject();

    // Reload the full-screen todo element
    if (this.project && this.project.grid[this.fullScreenTodoGridIndex]) {
      const element = this.project.grid[this.fullScreenTodoGridIndex].Screen_elements[this.fullScreenTodoElementIndex];
      if (element && element.constructor.name === 'ToDoLst') {
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

  onTaskDragStart(event: DragEvent, task: scheduled_task): void {
    if (!this.fullScreenTodoElement) return;
    this.draggedFullScreenTaskIndex = this.fullScreenTodoElement.scheduled_tasks.findIndex(t => t === task);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', '');
    }
  }

  onTaskDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  async onTaskDrop(event: DragEvent, targetTask: scheduled_task): Promise<void> {
    event.preventDefault();
    if (this.draggedFullScreenTaskIndex === -1 || !this.fullScreenTodoElement) {
      this.draggedFullScreenTaskIndex = -1;
      return;
    }

    const tasks = this.fullScreenTodoElement.scheduled_tasks;
    const draggedTask = tasks[this.draggedFullScreenTaskIndex];
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

    const elementData = this.project?.grid[this.selectedGridIndex].Screen_elements[index];

    if (!card) return;

    // Start long-press timer for dragging (500ms)
    this.longPressTimer = setTimeout(() => {

      this.isDraggingEnabled = true;
      const rect = card.getBoundingClientRect();
      this.elementDragOffsetX = event.clientX - rect.left;
      this.elementDragOffsetY = event.clientY - rect.top;
      this.draggedElementIndex = index;
      this.draggedElement = card;

      card.style.opacity = '0.7';
      card.style.cursor = 'grabbing';
      card.classList.add('dragging-active');
    }, 500);
  }

  onElementTouchStart(event: TouchEvent, element: Screen_Element, gridIndex: number, elementIndex: number): void {
  const target = event.target as HTMLElement;
  const card = event.currentTarget as HTMLElement;

  if (target.tagName === 'BUTTON' || target.closest('button')) {
    return;
  }

  if (!card) return;

  const touch = event.touches[0];

  this.longPressTimer = setTimeout(() => {
    this.isDraggingEnabled = true;
    const rect = card.getBoundingClientRect();
    this.elementDragOffsetX = touch.clientX - rect.left;
    this.elementDragOffsetY = touch.clientY - rect.top;
    this.draggedElementIndex = elementIndex;
    this.draggedElement = card;
    card.style.opacity = '0.7';
    card.classList.add('dragging-active');
  }, 500);
}

  onDocumentMouseMove(event: MouseEvent): void {
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
      // Save to backend
      const projectType = (this.project as any).projectType;
      if (projectType) {
        await this.dataService.saveProject(this.project, projectType);
      }
    }

    this.draggedElement.style.opacity = '1';
    this.draggedElement.style.cursor = 'grab';
    this.draggedElement.classList.remove('dragging-active');

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

  this.draggedElement.style.opacity = '1';
  this.draggedElement.style.cursor = 'grab';
  this.draggedElement.classList.remove('dragging-active');
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
    }
  }

  getElementStyle(element: Screen_Element): any {
    // Handle both class instances and plain objects
    const xpos = (element as any).get_xpos ? (element as any).get_xpos() : ((element as any).x_pos || 0);
    const ypos = (element as any).get_ypos ? (element as any).get_ypos() : ((element as any).y_pos || 0);
    const xscale = (element as any).get_x_scale ? (element as any).get_x_scale() : ((element as any).x_scale || 200);
    const yscale = (element as any).get_y_scale ? (element as any).get_y_scale() : ((element as any).y_scale || 100);

    return {
      'left.px': xpos,
      'top.px': ypos,
      'width.px': xscale,
      'height.px': yscale,
      'position': 'absolute'
    };
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
        }
      }
    }
  }

  async onCanvasMouseUp(event: MouseEvent): Promise<void> {
    if (this.isDraggingEnabled && this.draggedElementGridIndex >= 0 && this.draggedElementIndex >= 0 && this.project) {
      // Save position when drag ends
      const element = this.project.grid[this.draggedElementGridIndex].Screen_elements[this.draggedElementIndex];
      if (element) {
        const projectType = (this.project as any).projectType;
        if (!projectType) {
          console.error(`[ProjectDetail] Cannot save project ${this.project.name} - projectType is missing!`);
          return;
        }
        await this.dataService.saveProject(this.project, projectType);
      }
    }

    if (this.isResizing && this.resizingElement && this.project) {
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
    
    // Clear any pending timeouts
    if (this.savingTimeout) {
      clearTimeout(this.savingTimeout);
    }
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }
  }



}

