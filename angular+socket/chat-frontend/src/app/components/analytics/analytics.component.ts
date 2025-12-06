// import { Component, OnInit } from '@angular/core';

// import { DataService } from '../../services/data.service';
// import { AnalyticsService } from '../../services/analytics.service';
// import { User } from '../../../../../shared_models/models/user.model';
// import { ChartConfiguration, ChartData, ChartOptions } from 'chart.js';

// @Component({
//   selector: 'app-analytics',
//   standalone: true,
//   imports: [],
//   templateUrl: './analytics.component.html',
//   styleUrls: ['./analytics.component.css']
// })
// export class AnalyticsComponent implements OnInit {
//   currentUser: User | null = null;
//   productivityScore = 0;
//   totalTasks = 0;
//   completedTasks = 0;
//   bottlenecks: string[] = [];

//   // Productivity Trends Chart
//   public productivityChartData: ChartData<'line'> = {
//     labels: [],
//     datasets: [{
//       label: 'Completed Tasks',
//       data: [],
//       borderColor: '#667eea',
//       backgroundColor: 'rgba(102, 126, 234, 0.1)',
//       tension: 0.4,
//       fill: true
//     }, {
//       label: 'Total Tasks',
//       data: [],
//       borderColor: '#764ba2',
//       backgroundColor: 'rgba(118, 75, 162, 0.1)',
//       tension: 0.4,
//       fill: true
//     }]
//   };

//   public productivityChartOptions: ChartOptions<'line'> = {
//     responsive: true,
//     maintainAspectRatio: false,
//     plugins: {
//       legend: {
//         display: true,
//         position: 'top'
//       },
//       title: {
//         display: true,
//         text: 'Productivity Trends (Last 30 Days)'
//       }
//     },
//     scales: {
//       y: {
//         beginAtZero: true
//       }
//     }
//   };

//   // Task Distribution Chart
//   public distributionChartData: ChartData<'doughnut'> = {
//     labels: ['High Priority', 'Medium Priority', 'Low Priority'],
//     datasets: [{
//       data: [0, 0, 0],
//       backgroundColor: [
//         '#e74c3c',
//         '#f39c12',
//         '#27ae60'
//       ],
//       borderWidth: 2,
//       borderColor: '#fff'
//     }]
//   };

//   public distributionChartOptions: ChartOptions<'doughnut'> = {
//     responsive: true,
//     maintainAspectRatio: false,
//     plugins: {
//       legend: {
//         display: true,
//         position: 'bottom'
//       },
//       title: {
//         display: true,
//         text: 'Task Distribution by Priority'
//       }
//     }
//   };

//   // Completion Rate by Project Chart
//   public projectChartData: ChartData<'bar'> = {
//     labels: [],
//     datasets: [{
//       label: 'Completion Rate (%)',
//       data: [],
//       backgroundColor: '#667eea',
//       borderColor: '#764ba2',
//       borderWidth: 1
//     }]
//   };

//   public projectChartOptions: ChartOptions<'bar'> = {
//     responsive: true,
//     maintainAspectRatio: false,
//     plugins: {
//       legend: {
//         display: false
//       },
//       title: {
//         display: true,
//         text: 'Completion Rate by Project'
//       }
//     },
//     scales: {
//       y: {
//         beginAtZero: true,
//         max: 100,
//         ticks: {
//           callback: function(value: any) {
//             return value + '%';
//           }
//         }
//       }
//     }
//   };

//   constructor(
//     private dataService: DataService,
//     private analyticsService: AnalyticsService
//   ) {}

//   ngOnInit(): void {
//     this.dataService.currentUser$.subscribe(user => {
//       this.currentUser = user;
//       if (user) {
//         this.loadAnalytics();
//       }
//     });
//   }

//   loadAnalytics(): void {
//     if (!this.currentUser) return;

//     // Calculate basic stats
//     let allTasks: any[] = [];
//     this.currentUser.projects.forEach(project => {
//       project.grid.forEach(grid => {
//         grid.Screen_elements.forEach(element => {
//           if (element.constructor.name === 'ToDoLst') {
//             const todoList = element as any;
//             if (todoList.scheduled_tasks) {
//               allTasks = allTasks.concat(todoList.scheduled_tasks);
//             }
//           }
//         });
//       });
//     });

//     this.totalTasks = allTasks.length;
//     this.completedTasks = allTasks.filter((t: any) => t.is_done).length;
//     this.productivityScore = this.analyticsService.calculateProductivityScore(
//       this.totalTasks,
//       this.completedTasks
//     );

//     // Load productivity trends
//     const trends = this.analyticsService.getProductivityTrends(this.currentUser, 30);
//     this.productivityChartData = {
//       ...this.productivityChartData,
//       labels: trends.map(t => {
//         const date = new Date(t.date);
//         return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
//       }),
//       datasets: [{
//         ...this.productivityChartData.datasets[0],
//         data: trends.map(t => t.completed)
//       }, {
//         ...this.productivityChartData.datasets[1],
//         data: trends.map(t => t.total)
//       }]
//     };

//     // Load task distribution
//     const distribution = this.analyticsService.getTaskDistribution(this.currentUser);
//     this.distributionChartData = {
//       ...this.distributionChartData,
//       datasets: [{
//         ...this.distributionChartData.datasets[0],
//         data: [distribution[0].count, distribution[1].count, distribution[2].count]
//       }]
//     };

//     // Load project completion rates
//     const projectRates = this.analyticsService.getCompletionRateByProject(this.currentUser);
//     this.projectChartData = {
//       ...this.projectChartData,
//       labels: projectRates.map(p => p.projectName),
//       datasets: [{
//         ...this.projectChartData.datasets[0],
//         data: projectRates.map(p => p.completionRate)
//       }]
//     };

//     // Identify bottlenecks
//     this.bottlenecks = this.analyticsService.identifyBottlenecks(this.currentUser);
//   }

//   getCompletionRate(): number {
//     if (this.totalTasks === 0) return 0;
//     return Math.round((this.completedTasks / this.totalTasks) * 100);
//   }
// }
// analytics.component.ts
//=====================================================
// import { Component, OnInit } from '@angular/core';
// import { AnalyticsService } from '../../services/analytics.service';
// import { ChartDataset, ChartOptions } from 'chart.js';

// @Component({
//   selector: 'app-analytics',
//   template: `
//     <div>
//       <h3>Tasks completed per day (last 30 days)</h3>
//       <canvas baseChart
//               [data]="lineChartData"
//               [options]="lineChartOptions"
//               [type]="'line'">
//       </canvas>
//     </div>

//     <div style="margin-top: 2rem;">
//       <h3>Completion on-time % by tag</h3>
//       <canvas baseChart
//               [data]="barChartData"
//               [options]="barChartOptions"
//               [type]="'bar'">
//       </canvas>
//     </div>
//   `,
// })
// export class AnalyticsComponent implements OnInit {
//   public labels: string[] = [];
//   public lineChartData: { labels?: string[]; datasets: ChartDataset[] } = { datasets: [] };
//   public lineChartOptions: ChartOptions = {
//     responsive: true,
//     maintainAspectRatio: false,
//     interaction: { mode: 'index', intersect: false },
//     plugins: { legend: { position: 'top' } },
//     scales: {
//       x: { type: 'category', title: { display: true, text: 'Date' } },
//       y: { beginAtZero: true, title: { display: true, text: 'Tasks completed' } }
//     }
//   };

//   public barChartData: { labels: string[]; datasets: ChartDataset[] } = { labels: [], datasets: [] };
//   public barChartOptions: ChartOptions = {
//     responsive: true,
//     maintainAspectRatio: false,
//     plugins: { legend: { display: false } },
//     scales: { y: { beginAtZero: true, max: 1, ticks: { callback: v => String(Math.round(Number(v) * 100) + '%') } } }
//   };

//   constructor(private analytics: AnalyticsService) {}

//   ngOnInit() {
//     this.analytics.getCompletedPerDay(30).subscribe((res: any) => {
//       this.labels = res.labels;
//       // Convert series to Chart datasets
//       const datasets: ChartDataset[] = res.series.map((s: any) => ({
//         label: s.tag,
//         data: s.data,
//         // Chart.js will pick colors automatically; you can assign colors if you want
//         fill: false,
//         tension: 0.2
//       }));
//       this.lineChartData = { labels: this.labels, datasets };
//     });

//     this.analytics.getCompletionRateByTag(30).subscribe((res: any) => {
//       const labels = res.labels;
//       const values = res.values; // values are fractions 0..1
//       this.barChartData = {
//         labels,
//         datasets: [
//           { label: 'On-time %', data: values, /* you can set `backgroundColor` if desired */ }
//         ]
//       };
//     });
//   }
// }
//========================================================
import { Component, OnInit } from '@angular/core';
import { ChartDataset, ChartOptions, ChartData,registerables } from 'chart.js';
import { AnalyticsService, SeriesEntry } from '../../services/analytics.service';
import { FormsModule } from '@angular/forms';   // <-- ADD THIS
import { BaseChartDirective } from 'ng2-charts';
import { subscribe } from 'diagnostics_channel';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [
    BaseChartDirective,   // required for charts
    FormsModule       // required for ngModel
  ],
  templateUrl: './analytics.component.html'
})
export class AnalyticsComponent implements OnInit {

  lineChartMap: SeriesEntry[] = [];
  lineChartData: ChartData<'line'> = {
    labels: [],      // string[]
    datasets: []     // ChartDataset[]
  };
  lineChartLabels: string[] = [];
  availableTags: string[] = [];
  selectedTags: string[] = [];

  completionChartData: ChartData<'bar'> = {
    labels: [],
    datasets: [
      {
        label: 'Completion Rate (%)',
        data: []
      }
    ]
  };
  completionTags: string[] = [];
  completionValues: number[] = [];




  constructor(private analytics: AnalyticsService) { }

  // ngOnInit(): void {
  //   const tasks = JSON.parse(localStorage.getItem('tasks') || '[]');

  //   this.analytics.getCompletionRateByTag().subscribe(res => {
  //     this.availableTags = res.labels;
  //     this.selectedTags = [...this.availableTags];
  //     this.completionTags = res.labels;
  //     this.completionValues = res.values.map(v => Math.round(v * 100));
  //   }
  //   );

  //   this.analytics.getCompletedPerDay().subscribe(res => {
  //     this.lineChartLabels = res.labels;
  //     this.lineChartMap = res.series;
  //   });

  //   console.log('Available tags:', this.availableTags);
  //   console.log('Line chart map:', this.lineChartMap);
  //   console.log('Line chart labels:', this.lineChartLabels);
  //   console.log('Completion tags:', this.completionTags);
  //   console.log('Completion values:', this.completionValues);
  //   console.log('bar chart data:', this.completionChartData); 
  //   // Collect all days from all tags
  //   this.lineChartLabels = this.lineChartLabels.sort();
  //   this.updateLineChart();
  //   this.updateCompletionChart();
  // }
  ngOnInit(): void {

  // Completion rate
  this.analytics.getCompletionRateByTag().subscribe(res => {
    this.availableTags = res.labels;
    this.selectedTags = [...this.availableTags];
    this.completionTags = res.labels;
    this.completionValues = res.values.map(v => Math.round(v * 100));

    console.log("Completion API result:", res);
    console.log('bar chart data:', this.completionValues);

    this.updateCompletionChart();   // <-- FIXED
  });

  // Completed per day
  this.analytics.getCompletedPerDay().subscribe(res => {
    this.lineChartLabels = res.labels;
    this.lineChartMap = res.series;

    console.log("Completed per day API result:", res);
    console.log('line chart data:', this.lineChartMap);
    this.updateLineChart();         // <-- FIXED
  });
}


  updateLineChart() {
    console.log('Updating line chart with tags:', this.selectedTags);
    this.lineChartData = {
      labels: this.lineChartLabels,
      datasets: this.selectedTags.map(tag => ({
        label: tag,
        data: this.lineChartMap.find(s => s.tag === tag)?.data || [],
        // tension: 0.2,
        // fill: false
      }))
    }
    console.log('line chart data after update:', this.lineChartData);
  }
  updateCompletionChart() {
    console.log('Updating completion chart with tags:', this.selectedTags);
    this.completionChartData = {
      labels: this.completionTags,
      datasets: [
        {
          label: 'Completion Rate (%)',
          data: this.completionValues
        }
      ]
    };
    console.log('bar chart data after update:', this.completionChartData);
  }

}
