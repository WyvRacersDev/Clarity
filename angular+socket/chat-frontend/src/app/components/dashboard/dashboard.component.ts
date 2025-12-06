import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DataService } from '../../services/data.service';
import { AnalyticsService } from '../../services/analytics.service';
import { User } from '../../../../../shared_models/models/user.model';
import { Project } from '../../../../../shared_models/models/project.model';
import { scheduled_task } from '../../../../../shared_models/models/screen_elements.model';
import { calender } from '../../../../../shared_models/models/user.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
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

  constructor(
    private dataService: DataService,
    private analyticsService: AnalyticsService
  ) {}

  ngOnInit(): void {
    this.dataService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.loadDashboardData();
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
          if (element.constructor.name === 'ToDoLst') {
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

    // Calculate productivity score
    //this.productivityScore = this.analyticsService.calculateProductivityScore(
    //  this.totalTasks,
    //  this.completedTasks
    //);
  }

  getCompletionPercentage(): number {
    if (this.totalTasks === 0) return 0;
    return Math.round((this.completedTasks / this.totalTasks) * 100);
  }

  getProjectIndex(project: Project): number {
    if (!this.currentUser) return 0;
    return this.currentUser.projects.indexOf(project);
  }
}
