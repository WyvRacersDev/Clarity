import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { AnalyticsService } from '../../services/analytics.service';
import { User } from '../../../../../shared_models/models/user.model';
import { ChartConfiguration, ChartData, ChartOptions } from 'chart.js';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.css']
})
export class AnalyticsComponent implements OnInit {
  currentUser: User | null = null;
  productivityScore = 0;
  totalTasks = 0;
  completedTasks = 0;
  bottlenecks: string[] = [];

  // Productivity Trends Chart
  public productivityChartData: ChartData<'line'> = {
    labels: [],
    datasets: [{
      label: 'Completed Tasks',
      data: [],
      borderColor: '#667eea',
      backgroundColor: 'rgba(102, 126, 234, 0.1)',
      tension: 0.4,
      fill: true
    }, {
      label: 'Total Tasks',
      data: [],
      borderColor: '#764ba2',
      backgroundColor: 'rgba(118, 75, 162, 0.1)',
      tension: 0.4,
      fill: true
    }]
  };

  public productivityChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top'
      },
      title: {
        display: true,
        text: 'Productivity Trends (Last 30 Days)'
      }
    },
    scales: {
      y: {
        beginAtZero: true
      }
    }
  };

  // Task Distribution Chart
  public distributionChartData: ChartData<'doughnut'> = {
    labels: ['High Priority', 'Medium Priority', 'Low Priority'],
    datasets: [{
      data: [0, 0, 0],
      backgroundColor: [
        '#e74c3c',
        '#f39c12',
        '#27ae60'
      ],
      borderWidth: 2,
      borderColor: '#fff'
    }]
  };

  public distributionChartOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'bottom'
      },
      title: {
        display: true,
        text: 'Task Distribution by Priority'
      }
    }
  };

  // Completion Rate by Project Chart
  public projectChartData: ChartData<'bar'> = {
    labels: [],
    datasets: [{
      label: 'Completion Rate (%)',
      data: [],
      backgroundColor: '#667eea',
      borderColor: '#764ba2',
      borderWidth: 1
    }]
  };

  public projectChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      title: {
        display: true,
        text: 'Completion Rate by Project'
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        ticks: {
          callback: function(value: any) {
            return value + '%';
          }
        }
      }
    }
  };

  constructor(
    private dataService: DataService,
    private analyticsService: AnalyticsService
  ) {}

  ngOnInit(): void {
    this.dataService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.loadAnalytics();
      }
    });
  }

  loadAnalytics(): void {
    if (!this.currentUser) return;

    // Calculate basic stats
    let allTasks: any[] = [];
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
    this.completedTasks = allTasks.filter((t: any) => t.is_done).length;
    this.productivityScore = this.analyticsService.calculateProductivityScore(
      this.totalTasks,
      this.completedTasks
    );

    // Load productivity trends
    const trends = this.analyticsService.getProductivityTrends(this.currentUser, 30);
    this.productivityChartData = {
      ...this.productivityChartData,
      labels: trends.map(t => {
        const date = new Date(t.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }),
      datasets: [{
        ...this.productivityChartData.datasets[0],
        data: trends.map(t => t.completed)
      }, {
        ...this.productivityChartData.datasets[1],
        data: trends.map(t => t.total)
      }]
    };

    // Load task distribution
    const distribution = this.analyticsService.getTaskDistribution(this.currentUser);
    this.distributionChartData = {
      ...this.distributionChartData,
      datasets: [{
        ...this.distributionChartData.datasets[0],
        data: [distribution[0].count, distribution[1].count, distribution[2].count]
      }]
    };

    // Load project completion rates
    const projectRates = this.analyticsService.getCompletionRateByProject(this.currentUser);
    this.projectChartData = {
      ...this.projectChartData,
      labels: projectRates.map(p => p.projectName),
      datasets: [{
        ...this.projectChartData.datasets[0],
        data: projectRates.map(p => p.completionRate)
      }]
    };

    // Identify bottlenecks
    this.bottlenecks = this.analyticsService.identifyBottlenecks(this.currentUser);
  }

  getCompletionRate(): number {
    if (this.totalTasks === 0) return 0;
    return Math.round((this.completedTasks / this.totalTasks) * 100);
  }
}
