import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { User } from '../../../../../shared_models/models/user.model';
import { scheduled_task, ToDoLst } from '../../../../../shared_models/models/screen_elements.model';
import { calender } from '../../../../../shared_models/models/user.model';
import dayjs from 'dayjs';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tasks.component.html',
  styleUrls: ['./tasks.component.css']
})
export class TasksComponent implements OnInit {
  currentUser: User | null = null;
  allTasks: scheduled_task[] = [];
  filteredTasks: scheduled_task[] = [];
  selectedDate: string = dayjs().format('YYYY-MM-DD');
  viewMode: 'list' | 'calendar' = 'list';
  showAddTaskModal = false;
  newTaskName = '';
  newTaskPriority: 1 | 2 | 3 = 2;
  newTaskTime = '';
  filterPriority: 'all' | 1 | 2 | 3 = 'all';
  filterStatus: 'all' | 'completed' | 'pending' = 'all';
  selectedProjectIndex: number = 0;

  constructor(private dataService: DataService) {}

  ngOnInit(): void {
    this.dataService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.loadAllTasks();
      }
    });
  }

  loadAllTasks(): void {
    if (!this.currentUser) return;

    this.allTasks = [];
    this.currentUser.projects.forEach(project => {
      project.grid.forEach(grid => {
        grid.Screen_elements.forEach(element => {
          if (element.constructor.name === 'ToDoLst') {
            const todoList = element as any;
            if (todoList.scheduled_tasks) {
              this.allTasks = this.allTasks.concat(todoList.scheduled_tasks);
            }
          }
        });
      });
    });

    this.applyFilters();
  }

  applyFilters(): void {
    this.filteredTasks = this.allTasks.filter(task => {
      const matchesPriority = this.filterPriority === 'all' || task.priority === this.filterPriority;
      const matchesStatus = 
        this.filterStatus === 'all' ||
        (this.filterStatus === 'completed' && task.is_done) ||
        (this.filterStatus === 'pending' && !task.is_done);
      
      return matchesPriority && matchesStatus;
    });

    // Sort by time
    this.filteredTasks.sort((a, b) => {
      const dateA = new Date(a.time).getTime();
      const dateB = new Date(b.time).getTime();
      return dateA - dateB;
    });
  }

  onPriorityFilterChange(): void {
    this.applyFilters();
  }

  onStatusFilterChange(): void {
    this.applyFilters();
  }

  toggleTaskStatus(task: scheduled_task): void {
    task.toggle_done_status();
    this.dataService.updateCurrentUser();
    this.loadAllTasks();
  }

  openAddTaskModal(): void {
    this.showAddTaskModal = true;
    this.newTaskName = '';
    this.newTaskPriority = 2;
    this.newTaskTime = dayjs().format('YYYY-MM-DDTHH:mm');
  }

  closeAddTaskModal(): void {
    this.showAddTaskModal = false;
  }

  addTask(): void {
    if (!this.newTaskName.trim() || !this.newTaskTime) return;

    // Find first ToDoLst in first project/grid to add task
    if (this.currentUser && this.currentUser.projects.length > 0) {
      const firstProject = this.currentUser.projects[0];
      if (firstProject.grid.length > 0) {
        const firstGrid = firstProject.grid[0];
        const todoList = firstGrid.Screen_elements.find(
          el => el.constructor.name === 'ToDoLst'
        ) as any;

        if (todoList) {
          const task = new scheduled_task(
            this.newTaskName.trim(),
            this.newTaskPriority,
            this.newTaskTime
          );
          todoList.add_task(task);
          this.dataService.updateCurrentUser();
          this.loadAllTasks();
          this.closeAddTaskModal();
        } else {
          // Create a new ToDoLst if none exists
          const newTodoList = new ToDoLst('Tasks', 0, 0);
          const task = new scheduled_task(
            this.newTaskName.trim(),
            this.newTaskPriority,
            this.newTaskTime
          );
          newTodoList.add_task(task);
          this.dataService.addElementToGrid(0, 0, newTodoList);
          this.dataService.updateCurrentUser();
          this.loadAllTasks();
          this.closeAddTaskModal();
        }
      }
    }
  }

  getTasksForDate(date: string): scheduled_task[] {
    return this.allTasks.filter(task => {
      const taskDate = dayjs(task.time).format('YYYY-MM-DD');
      return taskDate === date;
    });
  }

  getUpcomingTasks(): scheduled_task[] {
    const now = dayjs();
    return this.allTasks
      .filter(task => !task.is_done && dayjs(task.time).isAfter(now))
      .sort((a, b) => dayjs(a.time).diff(dayjs(b.time)))
      .slice(0, 10);
  }

  getOverdueTasks(): scheduled_task[] {
    const now = dayjs();
    return this.allTasks.filter(
      task => !task.is_done && dayjs(task.time).isBefore(now)
    );
  }

  getPriorityClass(priority: number): string {
    return `priority-${priority}`;
  }

  getPriorityLabel(priority: number): string {
    return priority === 1 ? 'High' : priority === 2 ? 'Medium' : 'Low';
  }

  getPriorityColor(priority: number): string {
    return priority === 1 ? '#e74c3c' : priority === 2 ? '#f39c12' : '#27ae60';
  }

  formatTime(time: string): string {
    return dayjs(time).format('h:mm A');
  }

  formatDateTime(time: string): string {
    return dayjs(time).format('MMM D, YYYY h:mm A');
  }

  previousDay(): void {
    this.selectedDate = dayjs(this.selectedDate).subtract(1, 'day').format('YYYY-MM-DD');
  }

  nextDay(): void {
    this.selectedDate = dayjs(this.selectedDate).add(1, 'day').format('YYYY-MM-DD');
  }

  goToToday(): void {
    this.selectedDate = dayjs().format('YYYY-MM-DD');
  }

  getFormattedDate(format: string = 'MMMM D, YYYY'): string {
    return dayjs(this.selectedDate).format(format);
  }
}
