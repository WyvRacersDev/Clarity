import { Component, OnInit, signal, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser, CommonModule, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DataService } from '../../services/data.service';
import { AnalyticsService } from '../../services/analytics.service';
import { User } from '../../../../../shared_models/models/user.model';
import { Project } from '../../../../../shared_models/models/project.model';
import { scheduled_task } from '../../../../../shared_models/models/screen-elements.model';
import { calender } from '../../../../../shared_models/models/user.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  currentUser: User | null = null;
  totalProjects = 0;
  totalTasks = 0;
  completedTasks = 0;
  upcomingTasks: scheduled_task[] = [];
  recentProjects: Project[] = [];
  productivityScore = 0;

  // Local UI state (signals — zoneless-safe)
  isLoading = signal(true);
  today = signal(new Date());

  constructor(
    private dataService: DataService,
    private analyticsService: AnalyticsService,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  private isTodoListElement(element: any): boolean {
    if (element?.type === 'ToDoLst') {
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
        this.loadDashboardData();
        this.isLoading.set(false);
      } else {
        this.isLoading.set(false);
      }
    });
  }

  loadDashboardData(): void {
    if (!this.currentUser) return;

    this.totalProjects = this.currentUser.projects.length;
    this.recentProjects = this.currentUser.projects.slice(-5).reverse();

    // Calculate tasks from all projects
    let allTasks: scheduled_task[] = [];
    this.currentUser.projects.forEach(project => {
      project.grid.forEach(grid => {
        grid.Screen_elements.forEach(element => {
          if (this.isTodoListElement(element)) {
            const todoList = element as any;
            if (todoList.scheduled_tasks) {
              allTasks = allTasks.concat(todoList.scheduled_tasks);
            }
          }
        });
      });
    });

    this.totalTasks = allTasks.length;
    this.completedTasks = allTasks.filter(t => t.is_done).length;

    // Get upcoming tasks (next 7 days)
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    this.upcomingTasks = allTasks
      .filter(task => {
        const taskDate = new Date(task.time);
        return taskDate >= now && taskDate <= nextWeek && !task.is_done;
      })
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
      .slice(0, 5);
  }

  getCompletionPercentage(): number {
    if (this.totalTasks === 0) return 0;
    return Math.round((this.completedTasks / this.totalTasks) * 100);
  }

  getProjectIndex(project: Project): number {
    if (!this.currentUser) return 0;
    return this.currentUser.projects.indexOf(project);
  }

  getGreeting(): string {
    if (!isPlatformBrowser(this.platformId)) return 'Good day';
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  getProjectTaskCount(project: Project): number {
    let count = 0;
    project.grid.forEach(grid => {
      grid.Screen_elements.forEach(element => {
        if (this.isTodoListElement(element)) {
          const todoList = element as any;
          if (todoList.scheduled_tasks) {
            count += todoList.scheduled_tasks.length;
          }
        }
      });
    });
    return count;
  }

  getProjectCompletedCount(project: Project): number {
    let count = 0;
    project.grid.forEach(grid => {
      grid.Screen_elements.forEach(element => {
        if (this.isTodoListElement(element)) {
          const todoList = element as any;
          if (todoList.scheduled_tasks) {
            count += todoList.scheduled_tasks.filter((t: any) => t.is_done).length;
          }
        }
      });
    });
    return count;
  }

  getProjectProgress(project: Project): number {
    const total = this.getProjectTaskCount(project);
    if (total === 0) return 0;
    return Math.round((this.getProjectCompletedCount(project) / total) * 100);
  }

  getProjectInitials(project: Project): string {
    return (project.name || 'P')
      .split(' ')
      .slice(0, 2)
      .map((w: string) => w[0]?.toUpperCase() ?? '')
      .join('');
  }

  getPriorityLabel(priority: number): string {
    if (priority === 1) return 'High';
    if (priority === 2) return 'Medium';
    return 'Low';
  }

  getPriorityBadgeClass(priority: number): string {
    if (priority === 1) return 'badge-danger';
    if (priority === 2) return 'badge-warning';
    return 'badge-success';
  }

  isTaskDueSoon(task: scheduled_task): boolean {
    const taskDate = new Date(task.time);
    const now = new Date();
    const diff = taskDate.getTime() - now.getTime();
    return diff < 24 * 60 * 60 * 1000 && diff >= 0;
  }
}
