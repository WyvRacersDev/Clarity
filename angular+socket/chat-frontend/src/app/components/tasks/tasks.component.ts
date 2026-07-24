import { Component, OnInit, signal, computed, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { User } from '../../../../../shared_models/models/user.model';
import { scheduled_task, ToDoLst } from '../../../../../shared_models/models/screen-elements.model';
import { calender } from '../../../../../shared_models/models/user.model';
import dayjs from 'dayjs';

export interface CalendarDay {
  date: string;
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './tasks.component.html',
  styleUrls: ['./tasks.component.css']
})
export class TasksComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);

  // Existing data fields (preserved verbatim)
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

  // New local UI state (signals)
  readonly activeView = signal<'list' | 'calendar'>('list');
  readonly calendarMonth = signal<string>(dayjs().startOf('month').format('YYYY-MM-DD'));
  readonly isLoading = signal<boolean>(true);

  readonly calendarMonthLabel = computed(() =>
    dayjs(this.calendarMonth()).format('MMMM YYYY')
  );

  readonly calendarWeeks = computed((): CalendarDay[][] => {
    const monthStart = dayjs(this.calendarMonth());
    const gridStart = monthStart.startOf('week');
    const today = dayjs().format('YYYY-MM-DD');
    const weeks: CalendarDay[][] = [];
    let cursor = gridStart;
    for (let w = 0; w < 6; w++) {
      const week: CalendarDay[] = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = cursor.format('YYYY-MM-DD');
        week.push({
          date: dateStr,
          dayNum: cursor.date(),
          isCurrentMonth: cursor.month() === monthStart.month(),
          isToday: dateStr === today,
          isSelected: dateStr === this.selectedDate,
        });
        cursor = cursor.add(1, 'day');
      }
      weeks.push(week);
    }
    return weeks;
  });

  constructor(private dataService: DataService) {}

  private isTodoListElement(element: any): boolean {
    const explicitType = element?.type;
    if (explicitType === 'ToDoLst') {
      return true;
    }
    if (element?.constructor?.name === 'ToDoLst') {
      return true;
    }
    return Array.isArray(element?.scheduled_tasks);
  }

  ngOnInit(): void {
    this.dataService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.loadAllTasks();
      }
      this.isLoading.set(false);
    });
  }

  loadAllTasks(): void {
    if (!this.currentUser) return;

    this.allTasks = [];
    this.currentUser.projects.forEach(project => {
      project.grid.forEach(grid => {
        grid.Screen_elements.forEach(element => {
          if (this.isTodoListElement(element)) {
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

    if (this.currentUser && this.currentUser.projects.length > 0) {
      const firstProject = this.currentUser.projects[0];
      if (firstProject.grid.length > 0) {
        const firstGrid = firstProject.grid[0];
        const todoList = firstGrid.Screen_elements.find(
          el => this.isTodoListElement(el)
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
    // Returns CSS variable references (no hardcoded hex)
    if (priority === 1) return 'var(--danger)';
    if (priority === 2) return 'var(--accent-blue)';
    return 'var(--accent-teal)';
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

  // New local UI methods

  setView(view: 'list' | 'calendar'): void {
    this.activeView.set(view);
    this.viewMode = view;
    if (view === 'calendar') {
      this.calendarMonth.set(dayjs(this.selectedDate).startOf('month').format('YYYY-MM-DD'));
    }
  }

  previousMonth(): void {
    this.calendarMonth.set(
      dayjs(this.calendarMonth()).subtract(1, 'month').format('YYYY-MM-DD')
    );
  }

  nextMonth(): void {
    this.calendarMonth.set(
      dayjs(this.calendarMonth()).add(1, 'month').format('YYYY-MM-DD')
    );
  }

  selectCalendarDay(date: string): void {
    this.selectedDate = date;
  }

  getTaskPillLabel(task: scheduled_task): string {
    return task.taskname.slice(0, 12);
  }

  getPriorityBadgeClass(priority: number): string {
    // Maps priorities to Zedd Clarity album-spectrum hues
    if (priority === 1) return 'badge-danger';          // red — urgency stays
    if (priority === 2) return 'badge-priority-medium'; // album electric-blue
    return 'badge-priority-low';                        // album luminous-teal
  }

  getHighPriorityTasks(): scheduled_task[] {
    return this.filteredTasks.filter(t => t.priority === 1);
  }

  getMediumPriorityTasks(): scheduled_task[] {
    return this.filteredTasks.filter(t => t.priority === 2);
  }

  getLowPriorityTasks(): scheduled_task[] {
    return this.filteredTasks.filter(t => t.priority === 3);
  }

  getTaskCountForDate(date: string): number {
    return this.getTasksForDate(date).length;
  }

  isToday(): boolean {
    return this.selectedDate === dayjs().format('YYYY-MM-DD');
  }
}
