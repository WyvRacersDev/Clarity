import { Component, DestroyRef, OnInit, signal, computed, PLATFORM_ID, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { User } from '../../../../../shared_models/models/user.model';
import { scheduled_task, ToDoLst } from '../../../../../shared_models/models/screen-elements.model';
import { calender } from '../../../../../shared_models/models/user.model';
import dayjs from 'dayjs';
import { priorityLabel, priorityColorVar } from '../../shared/priority.util';

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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Existing data fields (preserved verbatim)
  currentUser: User | null = null;
  // Signal so `filteredTasks` (a computed) re-derives whenever the loaded task set
  // changes — a plain field wouldn't notify the computed / OnPush views.
  readonly allTasks = signal<scheduled_task[]>([]);
  // Signal so `calendarWeeks` (a computed) re-derives the selected-cell highlight
  // when the day changes on click/keyboard — a plain field wouldn't notify the computed.
  readonly selectedDate = signal<string>(dayjs().format('YYYY-MM-DD'));
  viewMode: 'list' | 'calendar' = 'list';
  showAddTaskModal = false;
  newTaskName = '';
  newTaskPriority: 1 | 2 | 3 = 2;
  newTaskTime = '';
  readonly filterPriority = signal<'all' | 1 | 2 | 3>('all');
  readonly filterStatus = signal<'all' | 'completed' | 'pending'>('all');
  selectedProjectIndex: number = 0;

  // Maps each loaded task to its owning project name (client-side, no service calls)
  private taskProjectMap = new WeakMap<scheduled_task, string>();

  // New local UI state (signals)
  readonly activeView = signal<'list' | 'calendar'>('list');
  readonly calendarMonth = signal<string>(dayjs().startOf('month').format('YYYY-MM-DD'));
  readonly isLoading = signal<boolean>(true);

  // Search + project-filter UI state (B accents; filters already-loaded tasks client-side)
  readonly searchQuery = signal<string>('');
  readonly activeProject = signal<string>('all');
  readonly projectMenuOpen = signal<boolean>(false);
  readonly projectNames = signal<string[]>([]);

  readonly activeProjectLabel = computed(() =>
    this.activeProject() === 'all' ? 'All projects' : this.activeProject()
  );

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
          isSelected: dateStr === this.selectedDate(),
        });
        cursor = cursor.add(1, 'day');
      }
      weeks.push(week);
    }
    return weeks;
  });

  // Derived task list — reacts to the loaded set, both filters, search and the
  // active project. Replaces the former imperative `applyFilters()` + manual calls.
  readonly filteredTasks = computed<scheduled_task[]>(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const project = this.activeProject();
    const priority = this.filterPriority();
    const status = this.filterStatus();

    return this.allTasks()
      .filter(task => {
        const matchesPriority = priority === 'all' || task.priority === priority;
        const matchesStatus =
          status === 'all' ||
          (status === 'completed' && task.is_done) ||
          (status === 'pending' && !task.is_done);
        const matchesSearch = !query || task.taskname.toLowerCase().includes(query);
        const matchesProject = project === 'all' || this.taskProjectMap.get(task) === project;
        return matchesPriority && matchesStatus && matchesSearch && matchesProject;
      })
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
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

    // E11: the ⌘K "New Task" action deep-links here with `?new=1`. Open the
    // add-task modal, then strip the flag so a refresh/back doesn't reopen it.
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        if (params['new'] && !this.showAddTaskModal) {
          this.openAddTaskModal();
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {},
            replaceUrl: true,
          });
        }
      });
  }

  loadAllTasks(): void {
    if (!this.currentUser) return;

    const collected: scheduled_task[] = [];
    this.taskProjectMap = new WeakMap<scheduled_task, string>();
    const names: string[] = [];
    this.currentUser.projects.forEach(project => {
      const projectName = (project as any).name ?? 'Untitled project';
      if (!names.includes(projectName)) {
        names.push(projectName);
      }
      project.grid.forEach(grid => {
        grid.Screen_elements.forEach(element => {
          if (this.isTodoListElement(element)) {
            const todoList = element as any;
            if (todoList.scheduled_tasks) {
              todoList.scheduled_tasks.forEach((task: scheduled_task) => {
                this.taskProjectMap.set(task, projectName);
              });
              collected.push(...todoList.scheduled_tasks);
            }
          }
        });
      });
    });
    this.projectNames.set(names);
    // If the active project no longer exists, reset to "all"
    if (this.activeProject() !== 'all' && !names.includes(this.activeProject())) {
      this.activeProject.set('all');
    }

    // Setting the signal re-derives `filteredTasks` (and its dependents) — no manual filter pass.
    this.allTasks.set(collected);
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
  }

  toggleProjectMenu(): void {
    this.projectMenuOpen.update(open => !open);
  }

  closeProjectMenu(): void {
    this.projectMenuOpen.set(false);
  }

  selectProject(project: string): void {
    this.activeProject.set(project);
    this.projectMenuOpen.set(false);
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

  private matchesSearchAndProject(task: scheduled_task): boolean {
    const query = this.searchQuery().trim().toLowerCase();
    const project = this.activeProject();
    const matchesSearch = !query || task.taskname.toLowerCase().includes(query);
    const matchesProject = project === 'all' || this.taskProjectMap.get(task) === project;
    return matchesSearch && matchesProject;
  }

  getTasksForDate(date: string): scheduled_task[] {
    return this.allTasks().filter(task => {
      const taskDate = dayjs(task.time).format('YYYY-MM-DD');
      return taskDate === date && this.matchesSearchAndProject(task);
    });
  }

  getUpcomingTasks(): scheduled_task[] {
    const now = dayjs();
    return this.allTasks()
      .filter(task => !task.is_done && dayjs(task.time).isAfter(now) && this.matchesSearchAndProject(task))
      .sort((a, b) => dayjs(a.time).diff(dayjs(b.time)))
      .slice(0, 10);
  }

  getOverdueTasks(): scheduled_task[] {
    const now = dayjs();
    return this.allTasks().filter(
      task => !task.is_done && dayjs(task.time).isBefore(now) && this.matchesSearchAndProject(task)
    );
  }

  getPriorityClass(priority: number): string {
    return `priority-${priority}`;
  }

  getPriorityLabel(priority: number): string {
    return priorityLabel(priority);
  }

  getPriorityColor(priority: number): string {
    return priorityColorVar(priority);
  }

  formatTime(time: string): string {
    return dayjs(time).format('h:mm A');
  }

  formatDateTime(time: string): string {
    return dayjs(time).format('MMM D, YYYY h:mm A');
  }

  previousDay(): void {
    this.selectedDate.set(dayjs(this.selectedDate()).subtract(1, 'day').format('YYYY-MM-DD'));
  }

  nextDay(): void {
    this.selectedDate.set(dayjs(this.selectedDate()).add(1, 'day').format('YYYY-MM-DD'));
  }

  goToToday(): void {
    this.selectedDate.set(dayjs().format('YYYY-MM-DD'));
  }

  getFormattedDate(format: string = 'MMMM D, YYYY'): string {
    return dayjs(this.selectedDate()).format(format);
  }

  // New local UI methods

  setView(view: 'list' | 'calendar'): void {
    this.activeView.set(view);
    this.viewMode = view;
    if (view === 'calendar') {
      this.calendarMonth.set(dayjs(this.selectedDate()).startOf('month').format('YYYY-MM-DD'));
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
    this.selectedDate.set(date);
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
    return this.filteredTasks().filter(t => t.priority === 1);
  }

  getMediumPriorityTasks(): scheduled_task[] {
    return this.filteredTasks().filter(t => t.priority === 2);
  }

  getLowPriorityTasks(): scheduled_task[] {
    return this.filteredTasks().filter(t => t.priority === 3);
  }

  getTaskCountForDate(date: string): number {
    return this.getTasksForDate(date).length;
  }

  isToday(): boolean {
    return this.selectedDate() === dayjs().format('YYYY-MM-DD');
  }
}
