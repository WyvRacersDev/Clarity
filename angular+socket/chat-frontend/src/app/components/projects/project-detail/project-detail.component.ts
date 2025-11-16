import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
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
  currentUser: User | null = null;
  project: Project | null = null;
  projectIndex: number = -1;
  selectedGridIndex: number = 0;
  showCreateGridModal = false;
  newGridName = '';
  showAddElementModal = false;
  newElementType: 'ToDoLst' | 'Text_document' = 'ToDoLst';
  viewMode: 'kanban' | 'grid' = 'kanban';
  draggedTask: any = null;
  draggedFromColumn: number = -1;
  draggedFromList: number = -1;
  draggedTaskIndex: number = -1;
  showAddTaskModal = false;
  newTaskName = '';
  newTaskPriority = 2;
  taskColumnIndex = -1;

  constructor(
    private dataService: DataService,
    private socketService: SocketService,
    private route: ActivatedRoute
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
    this.showAddElementModal = true;
  }

  closeAddElementModal(): void {
    this.showAddElementModal = false;
  }

  addElement(): void {
    if (!this.project || this.selectedGridIndex < 0) return;

    let element: Screen_Element;
    if (this.newElementType === 'ToDoLst') {
      element = new ToDoLst('New Todo List', 0, 0);
    } else {
      element = new Text_document('New Document', 0, 0, '');
    }

    this.dataService.addElementToGrid(this.projectIndex, this.selectedGridIndex, element);
    
    // Emit update via socket
    this.socketService.emitElementUpdate(
      element,
      this.project.name,
      this.project.grid[this.selectedGridIndex].name
    );

    this.closeAddElementModal();
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

  getTextContent(element: Screen_Element): string {
    if (element.constructor.name === 'Text_document') {
      return (element as any).Text_field || 'Empty document';
    }
    return '';
  }

  getImagePath(element: Screen_Element): string {
    if (element.constructor.name === 'Image') {
      return (element as any).imagepath || '';
    }
    return '';
  }

  getImageDescription(element: Screen_Element): string {
    if (element.constructor.name === 'Image') {
      return (element as any).imageDescription || '';
    }
    return '';
  }

  getVideoPath(element: Screen_Element): string {
    if (element.constructor.name === 'Video') {
      return (element as any).VideoPath || '';
    }
    return '';
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

  onTaskToggle(task: any): void {
    task.toggle_done_status();
    this.dataService.updateCurrentUser();
  }
}

