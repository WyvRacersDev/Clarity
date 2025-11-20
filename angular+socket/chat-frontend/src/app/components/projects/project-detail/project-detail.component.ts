import { Component, OnInit } from '@angular/core';
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
  newElementType: 'ToDoLst' | 'Image' | 'Video' = 'ToDoLst';
  viewMode: 'kanban' | 'grid' = 'grid';
  draggedTask: any = null;
  draggedFromColumn: number = -1;
  draggedFromList: number = -1;
  draggedTaskIndex: number = -1;
  showAddTaskModal = false;
  newTaskName = '';
  newTaskPriority = 2;
  taskColumnIndex = -1;
  
  // Canvas dragging
  draggedElement: HTMLElement | null = null;
  draggedElementIndex: number = -1;
  draggedElementGridIndex: number = -1;
  elementDragOffsetX: number = 0;
  elementDragOffsetY: number = 0;
  isDraggingEnabled: boolean = false;
  longPressTimer: any = null;
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

  constructor(
    private dataService: DataService,
    private socketService: SocketService,
    private route: ActivatedRoute,
    private sanitizer: DomSanitizer
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

  createGrid(): void {
    if (this.newGridName.trim() && this.projectIndex >= 0) {
      this.dataService.createGrid(this.projectIndex, this.newGridName.trim());
      this.closeCreateGridModal();
      if (this.project) {
        this.selectedGridIndex = this.project.grid.length - 1;
      }
    }
  }

  deleteGrid(index: number): void {
    if (this.project && confirm(`Delete grid "${this.project.grid[index].name}"?`)) {
      this.dataService.deleteGrid(this.projectIndex, index);
      if (this.selectedGridIndex >= this.project.grid.length) {
        this.selectedGridIndex = Math.max(0, this.project.grid.length - 1);
      }
    }
  }

  openAddElementModal(): void {
    this.showElementTypeSelector = true;
  }

  selectElementType(type: 'ToDoLst' | 'Image' | 'Video'): void {
    this.newElementType = type;
    this.showElementTypeSelector = false;
    
    if (type === 'Image') {
      this.triggerImageUpload();
    } else if (type === 'Video') {
      this.triggerVideoUpload();
    } else if (type === 'ToDoLst') {
      this.createTodoElement();
    }
  }

  createTodoElement(): void {
    if (!this.project || this.selectedGridIndex < 0) return;
    
    const element = new ToDoLst('Tasks', 200, 200);
    this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
    this.dataService.updateCurrentUser();
  }

  triggerImageUpload(): void {
    if (!this.fileInput) {
      this.fileInput = document.createElement('input');
      this.fileInput.type = 'file';
      this.fileInput.accept = 'image/*';
      this.fileInput.onchange = () => this.handleImageUpload();
    }
    this.fileInput.click();
  }

  triggerVideoUpload(): void {
    if (!this.fileInput) {
      this.fileInput = document.createElement('input');
      this.fileInput.type = 'file';
      this.fileInput.accept = 'video/*';
      this.fileInput.onchange = () => this.handleVideoUpload();
    }
    this.fileInput.click();
  }

  handleImageUpload(): void {
    if (!this.fileInput || !this.fileInput.files || !this.project) return;
    
    const file = this.fileInput.files[0];
    const reader = new FileReader();
    
    reader.onload = (e: any) => {
      const imageUrl = e.target.result;
      const element = new Image(imageUrl, 400, 300, 'New Image', '');
      element.set_x_scale(300); // width
      element.set_y_scale(200); // height
      this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
      this.dataService.updateCurrentUser();
      this.socketService.emitElementUpdate(element, this.project!.name, this.project!.grid[this.selectedGridIndex].name);
    };
    
    reader.readAsDataURL(file);
  }

  handleVideoUpload(): void {
    if (!this.fileInput || !this.fileInput.files || !this.project) return;
    
    const file = this.fileInput.files[0];
    const reader = new FileReader();
    
    reader.onload = (e: any) => {
      const videoUrl = e.target.result;
      const element = new Video(videoUrl, 400, 300, 'New Video', '');
      element.set_x_scale(400); // width
      element.set_y_scale(300); // height
      this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
      this.dataService.updateCurrentUser();
      this.socketService.emitElementUpdate(element, this.project!.name, this.project!.grid[this.selectedGridIndex].name);
    };
    
    reader.readAsDataURL(file);
  }

  onTaskToggle(task: any): void {
    task.toggle_done_status();
    this.dataService.updateCurrentUser();
  }

  startEditingText(element: Screen_Element, gridIndex: number, elementIndex: number): void {
    // Removed - text elements no longer supported
  }

  deleteElement(elementIndex: number): void {
    if (this.project && this.selectedGridIndex >= 0) {
      this.dataService.removeElementFromGrid(this.projectIndex, this.selectedGridIndex, elementIndex);
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

  onDrop(event: DragEvent, targetColumnIndex: number): void {
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
      this.dataService.addElementToGrid(this.projectIndex, targetColumnIndex, targetTodoList);
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

  closeAddTaskModal(): void {
    this.showAddTaskModal = false;
    this.newTaskName = '';
    this.taskColumnIndex = -1;
  }

  submitAddTask(): void {
    if (!this.project || this.taskColumnIndex === -1 || !this.newTaskName.trim()) return;
    
    let todoList = this.getTodoListForColumn(this.taskColumnIndex);
    
    if (!todoList) {
      // Create new todo list
      todoList = new ToDoLst('Tasks', 0, 0);
      this.dataService.addElementToGrid(this.projectIndex, this.taskColumnIndex, todoList);
    }
    
    // Create new task
    const task = new scheduled_task(this.newTaskName.trim(), this.newTaskPriority, new Date().toISOString());
    todoList.add_task(task);
    this.dataService.updateCurrentUser();
    
    this.closeAddTaskModal();
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
      (element as any).position_x = x;
      (element as any).position_y = y;
      this.dataService.updateCurrentUser();
    }

    this.draggedElement.style.opacity = '1';
    this.draggedElement.style.cursor = 'grab';
    this.draggedElement.classList.remove('dragging-active');

    this.draggedElement = null;
    this.draggedElementIndex = -1;
    this.isDraggingEnabled = false;
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

  onCanvasMouseUp(event: MouseEvent): void {
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

