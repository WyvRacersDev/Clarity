import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { DataService } from '../../../services/data.service';
import { SocketService } from '../../../services/socket.service';
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
export class ProjectDetailComponent implements OnInit {
  // Make Math available in template
  Math = Math;
  
  currentUser: User | null = null;
  project: Project | null = null;
  projectIndex: number = -1;
  selectedGridIndex: number = 0;
  showCreateGridModal = false;
  newGridName = '';
  showAddElementModal = false;
  newElementType: 'ToDoLst' | 'Image' | 'Video' | 'Text_document' = 'ToDoLst';
  viewMode: 'kanban' | 'grid' = 'grid';
  draggedTask: any = null;
  draggedFromColumn: number = -1;
  draggedFromList: number = -1;
  draggedTaskIndex: number = -1;
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
  
  // Full-screen todo list view
  showFullScreenTodo = false;
  fullScreenTodoElement: ToDoLst | null = null;
  fullScreenTodoElementIndex = -1;
  fullScreenTodoGridIndex = -1;
  showCompletedTasks = true;
  
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

  constructor(
    private dataService: DataService,
    private socketService: SocketService,
    private route: ActivatedRoute,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) {}

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
      this.cdr.detectChanges();
    });
    
    this.dataService.loadingProject$.subscribe(loading => {
      this.isLoading = loading;
      this.cdr.detectChanges();
    });

    // Listen for real-time updates
    this.socketService.onElementUpdate().subscribe((data: any) => {
      if (this.project && data.projectId === this.project.name) {
        this.loadProject();
      }
    });

    // Global mouse move and up listeners for drag
    document.addEventListener('mousemove', (e) => this.onDocumentMouseMove(e));
    document.addEventListener('mouseup', (e) => this.onDocumentMouseUp(e));
    document.addEventListener('mousedown', (e) => this.onDocumentMouseDown(e));
  }

  loadProject(): void {
    if (this.currentUser && this.projectIndex >= 0 && this.currentUser.projects[this.projectIndex]) {
      this.project = this.currentUser.projects[this.projectIndex];
      if (this.project.grid.length > 0 && this.selectedGridIndex >= this.project.grid.length) {
        this.selectedGridIndex = 0;
      }
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

  async createGrid(): Promise<void> {
    if (this.newGridName.trim() && this.projectIndex >= 0) {
      await this.dataService.createGrid(this.projectIndex, this.newGridName.trim());
      this.closeCreateGridModal();
      if (this.project) {
        this.selectedGridIndex = this.project.grid.length - 1;
      }
    }
  }

  async deleteGrid(index: number): Promise<void> {
    if (this.project && confirm(`Delete grid "${this.project.grid[index].name}"?`)) {
      await this.dataService.deleteGrid(this.projectIndex, index);
      if (this.selectedGridIndex >= this.project.grid.length) {
        this.selectedGridIndex = Math.max(0, this.project.grid.length - 1);
      }
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
    this.fileInput.onchange = () => this.handleImageUpload();
    this.fileInput.click();
  }

  triggerVideoUpload(): void {
    // Reset file input to ensure accept attribute is correct
    if (this.fileInput) {
      this.fileInput.remove();
    }
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'video/*';
    this.fileInput.onchange = () => this.handleVideoUpload();
    this.fileInput.click();
  }

  handleImageUpload(): void {
    if (!this.fileInput || !this.fileInput.files || !this.project) return;
    
    const file = this.fileInput.files[0];
    const reader = new FileReader();
    
    reader.onload = async (e: any) => {
      const imageUrl = e.target.result;
      const element = new Image(imageUrl, 400, 300, 'New Image', '');
      element.set_x_scale(300); // width
      element.set_y_scale(200); // height
      await this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
      this.socketService.emitElementUpdate(element, this.project!.name, this.project!.grid[this.selectedGridIndex].name);
      this.loadProject(); // Reload to see the changes
      this.cdr.detectChanges();
    };
    
    reader.readAsDataURL(file);
  }

  handleVideoUpload(): void {
    if (!this.fileInput || !this.fileInput.files || !this.project) return;
    
    const file = this.fileInput.files[0];
    const reader = new FileReader();
    
    reader.onload = async (e: any) => {
      const videoUrl = e.target.result;
      const element = new Video(videoUrl, 400, 300, 'New Video', '');
      element.set_x_scale(400); // width
      element.set_y_scale(300); // height
      await this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
      this.socketService.emitElementUpdate(element, this.project!.name, this.project!.grid[this.selectedGridIndex].name);
      this.loadProject(); // Reload to see the changes
      this.cdr.detectChanges();
    };
    
    reader.readAsDataURL(file);
  }

  async onTaskToggle(task: any): Promise<void> {
    task.toggle_done_status();
    this.dataService.updateCurrentUser();
    // Save the project to persist changes
    if (this.project) {
      await this.dataService.saveProject(this.project, (this.project as any).projectType || 'local');
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
      await this.dataService.saveProject(this.project, (this.project as any).projectType || 'local');
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
    if (!this.project || this.selectedGridIndex < 0 || !this.newTextDocumentName.trim()) return;
    
    const element = new Text_document(
      this.newTextDocumentName.trim(),
      200,
      200,
      this.newTextDocumentContent || ''
    );
    await this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
    this.socketService.emitElementUpdate(element, this.project.name, this.project.grid[this.selectedGridIndex].name);
    this.loadProject(); // Reload to see the changes
    this.cdr.detectChanges();
    this.closeAddTextModal();
  }

  async deleteElement(elementIndex: number): Promise<void> {
    if (this.project && this.selectedGridIndex >= 0) {
      await this.dataService.removeElementFromGrid(this.projectIndex, this.selectedGridIndex, elementIndex);
      this.loadProject(); // Reload to see the changes
      this.cdr.detectChanges();
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

  getImageDescription(element: Screen_Element): string {
    if (element.constructor.name === 'Image') {
      return (element as any).imageDescription || '';
    }
    return '';
  }

  getVideoPath(element: Screen_Element): SafeUrl {
    if (element.constructor.name === 'Video') {
      const path = (element as any).VideoPath || '';
      return this.sanitizer.bypassSecurityTrustUrl(path);
    }
    return this.sanitizer.bypassSecurityTrustUrl('');
  }

  getVideoDescription(element: Screen_Element): string {
    if (element.constructor.name === 'Video') {
      return (element as any).VideoDescription || '';
    }
    return '';
  }

  // Kanban methods
  getAllTasksFromProject(): { columnIndex: number; listIndex: number; taskIndex: number; task: any; columnName: string }[] {
    const allTasks: { columnIndex: number; listIndex: number; taskIndex: number; task: any; columnName: string }[] = [];
    
    if (!this.project) return allTasks;

    this.project.grid.forEach((grid: Grid, columnIndex: number) => {
      grid.Screen_elements.forEach((element: Screen_Element, listIndex: number) => {
        if (element.constructor.name === 'ToDoLst') {
          const todoList = element as any;
          if (todoList.scheduled_tasks) {
            todoList.scheduled_tasks.forEach((task: any, taskIndex: number) => {
              allTasks.push({
                columnIndex,
                listIndex,
                taskIndex,
                task,
                columnName: grid.name
              });
            });
          }
        }
      });
    });

    return allTasks;
  }

  getTasksForColumn(columnIndex: number): any[] {
    if (!this.project || !this.project.grid[columnIndex]) return [];
    
    const allTasks: any[] = [];
    this.project.grid[columnIndex].Screen_elements.forEach((element: Screen_Element) => {
      if (element.constructor.name === 'ToDoLst') {
        const todoList = element as any;
        if (todoList.scheduled_tasks) {
          allTasks.push(...todoList.scheduled_tasks);
        }
      }
    });
    
    return allTasks;
  }

  getTodoListForColumn(columnIndex: number): ToDoLst | null {
    if (!this.project || !this.project.grid[columnIndex]) return null;
    
    const todoList = this.project.grid[columnIndex].Screen_elements.find(
      (el: Screen_Element) => el.constructor.name === 'ToDoLst'
    ) as ToDoLst | undefined;
    
    return todoList || null;
  }

  onDragStart(event: DragEvent, task: any, columnIndex: number, listIndex: number, taskIndex: number): void {
    if (!this.project) return;
    
    // Find the actual todo list and task index
    const grid = this.project.grid[columnIndex];
    let foundListIndex = -1;
    let foundTaskIndex = -1;
    
    grid.Screen_elements.forEach((element: Screen_Element, idx: number) => {
      if (element.constructor.name === 'ToDoLst') {
        const todoList = element as any;
        if (todoList.scheduled_tasks) {
          const taskIdx = todoList.scheduled_tasks.findIndex((t: any) => t === task);
          if (taskIdx !== -1) {
            foundListIndex = idx;
            foundTaskIndex = taskIdx;
          }
        }
      }
    });
    
    this.draggedTask = task;
    this.draggedFromColumn = columnIndex;
    this.draggedFromList = foundListIndex;
    this.draggedTaskIndex = foundTaskIndex;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  async onDrop(event: DragEvent, targetColumnIndex: number): Promise<void> {
    event.preventDefault();
    
    if (!this.project || this.draggedTask === null || this.draggedFromColumn === -1) return;

    // Get source and target todo lists
    const sourceGrid = this.project.grid[this.draggedFromColumn];
    const targetGrid = this.project.grid[targetColumnIndex];
    
    if (!sourceGrid || !targetGrid) return;

    const sourceElement = sourceGrid.Screen_elements[this.draggedFromList];
    if (sourceElement.constructor.name !== 'ToDoLst') return;

    const sourceTodoList = sourceElement as any;
    
    // Find or create target todo list
    let targetTodoList = targetGrid.Screen_elements.find(
      (el: Screen_Element) => el.constructor.name === 'ToDoLst'
    ) as any;

    if (!targetTodoList) {
      // Create a new todo list in target column
      targetTodoList = new ToDoLst('Tasks', 0, 0);
      await this.dataService.addElementToGrid(this.projectIndex, targetColumnIndex, targetTodoList);
    }

    // Remove task from source
    sourceTodoList.scheduled_tasks.splice(this.draggedTaskIndex, 1);
    
    // Add task to target
    targetTodoList.add_task(this.draggedTask);
    
    // Update data
    this.dataService.updateCurrentUser();
    
    // Emit socket update
    this.socketService.emitTaskUpdate(this.draggedTask, this.project.name);
    
    // Reset drag state
    this.draggedTask = null;
    this.draggedFromColumn = -1;
    this.draggedFromList = -1;
    this.draggedTaskIndex = -1;
  }

  onDragEnd(): void {
    this.draggedTask = null;
    this.draggedFromColumn = -1;
    this.draggedFromList = -1;
    this.draggedTaskIndex = -1;
  }

  addTaskToColumn(columnIndex: number): void {
    this.taskColumnIndex = columnIndex;
    this.showAddTaskModal = true;
    this.newTaskName = '';
    this.newTaskPriority = 2;
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
    
    // Otherwise, find the first todo list in the column (for kanban view)
    if (!todoList) {
      todoList = this.getTodoListForColumn(this.taskColumnIndex);
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
    // Don't open if we're dragging or just finished dragging
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
      await this.dataService.saveProject(this.project, (this.project as any).projectType || 'local');
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

  onDocumentMouseMove(event: MouseEvent): void {
    if (!this.isDraggingEnabled || this.draggedElement === null || !this.project) return;

    const container = document.querySelector('.elements-grid') as HTMLElement;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const x = event.clientX - containerRect.left - this.elementDragOffsetX;
    const y = event.clientY - containerRect.top - this.elementDragOffsetY;

    this.draggedElement.style.position = 'absolute';
    this.draggedElement.style.left = x + 'px';
    this.draggedElement.style.top = y + 'px';
    this.draggedElement.style.zIndex = '1000';
  }

  onDocumentMouseUp(event: MouseEvent): void {
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
    const x = Math.max(0, event.clientX - containerRect.left - this.elementDragOffsetX);
    const y = Math.max(0, event.clientY - containerRect.top - this.elementDragOffsetY);

    // Save the position to the element
    const element = this.project.grid[this.selectedGridIndex].Screen_elements[this.draggedElementIndex];
    if (element) {
      element.set_xpos(x);
      element.set_ypos(y);
      // Save to backend
      this.dataService.saveProject(this.project, (this.project as any).projectType || 'local');
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

  onElementMouseLeave(): void {
    // Only clear timer, don't stop dragging on leave
    if (!this.isDraggingEnabled && this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  getElementStyle(element: Screen_Element): any {
    return {
      'left.px': element.get_xpos() || 0,
      'top.px': element.get_ypos() || 0,
      'width.px': element.get_x_scale() || 200,
      'height.px': element.get_y_scale() || 100,
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
      
      this.resizingElement.set_x_scale(newWidth);
      this.resizingElement.set_y_scale(newHeight);
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
          (element as any).set_xpos(Math.max(0, x));
          (element as any).set_ypos(Math.max(0, y));
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
        await this.dataService.saveProject(this.project, (this.project as any).projectType || 'local');
      }
    }
    
    if (this.isResizing && this.resizingElement && this.project) {
      // Save size changes
      await this.dataService.saveProject(this.project, (this.project as any).projectType || 'local');
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
    this.startWidth = element.get_x_scale();
    this.startHeight = element.get_y_scale();
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
}

