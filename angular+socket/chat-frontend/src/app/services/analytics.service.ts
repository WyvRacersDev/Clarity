// import { Injectable } from '@angular/core';
// import { User } from '../../../../shared_models/models/user.model';
// import { scheduled_task } from '../../../../shared_models/models/screen_elements.model';

// export interface ProductivityTrend {
//   date: string;
//   completed: number;
//   total: number;
// }

// export interface TaskDistribution {
//   priority: string;
//   count: number;
// }

// @Injectable({
//   providedIn: 'root'
// })
// export class AnalyticsService {

//   calculateProductivityScore(totalTasks: number, completedTasks: number): number {
//     if (totalTasks === 0) return 100;
//     const completionRate = (completedTasks / totalTasks) * 100;
//     return Math.round(completionRate);
//   }

//   getProductivityTrends(user: User, days: number = 30): ProductivityTrend[] {
//     const trends: ProductivityTrend[] = [];
//     const now = new Date();
    
//     for (let i = days - 1; i >= 0; i--) {
//       const date = new Date(now);
//       date.setDate(date.getDate() - i);
//       const dateStr = date.toISOString().split('T')[0];
      
//       let completed = 0;
//       let total = 0;
      
//       // Collect all tasks from all projects
//       user.projects.forEach(project => {
//         project.grid.forEach(grid => {
//           grid.Screen_elements.forEach(element => {
//             if (element.constructor.name === 'ToDoLst') {
//               const todoList = element as any;
//               if (todoList.scheduled_tasks) {
//                 todoList.scheduled_tasks.forEach((task: scheduled_task) => {
//                   const taskDate = new Date(task.time).toISOString().split('T')[0];
//                   if (taskDate === dateStr) {
//                     total++;
//                     if (task.is_done) {
//                       completed++;
//                     }
//                   }
//                 });
//               }
//             }
//           });
//         });
//       });
      
//       trends.push({ date: dateStr, completed, total });
//     }
    
//     return trends;
//   }

//   getTaskDistribution(user: User): TaskDistribution[] {
//     const distribution: { [key: number]: number } = { 1: 0, 2: 0, 3: 0 };
    
//     user.projects.forEach(project => {
//       project.grid.forEach(grid => {
//         grid.Screen_elements.forEach(element => {
//           if (element.constructor.name === 'ToDoLst') {
//             const todoList = element as any;
//             if (todoList.scheduled_tasks) {
//               todoList.scheduled_tasks.forEach((task: scheduled_task) => {
//                 distribution[task.priority] = (distribution[task.priority] || 0) + 1;
//               });
//             }
//           }
//         });
//       });
//     });
    
//     return [
//       { priority: 'High', count: distribution[1] },
//       { priority: 'Medium', count: distribution[2] },
//       { priority: 'Low', count: distribution[3] }
//     ];
//   }

//   getCompletionRateByProject(user: User): { projectName: string; completionRate: number }[] {
//     return user.projects.map(project => {
//       let totalTasks = 0;
//       let completedTasks = 0;
      
//       project.grid.forEach(grid => {
//         grid.Screen_elements.forEach(element => {
//           if (element.constructor.name === 'ToDoLst') {
//             const todoList = element as any;
//             if (todoList.scheduled_tasks) {
//               todoList.scheduled_tasks.forEach((task: scheduled_task) => {
//                 totalTasks++;
//                 if (task.is_done) {
//                   completedTasks++;
//                 }
//               });
//             }
//           }
//         });
//       });
      
//       const completionRate = totalTasks === 0 ? 0 : (completedTasks / totalTasks) * 100;
//       return { projectName: project.name, completionRate: Math.round(completionRate) };
//     });
//   }

//   identifyBottlenecks(user: User): string[] {
//     const bottlenecks: string[] = [];
    
//     // Check for overdue tasks
//     const now = new Date();
//     let overdueCount = 0;
    
//     user.projects.forEach(project => {
//       project.grid.forEach(grid => {
//         grid.Screen_elements.forEach(element => {
//           if (element.constructor.name === 'ToDoLst') {
//             const todoList = element as any;
//             if (todoList.scheduled_tasks) {
//               todoList.scheduled_tasks.forEach((task: scheduled_task) => {
//                 if (!task.is_done && new Date(task.time) < now) {
//                   overdueCount++;
//                 }
//               });
//             }
//           }
//         });
//       });
//     });
    
//     if (overdueCount > 0) {
//       bottlenecks.push(`You have ${overdueCount} overdue task${overdueCount > 1 ? 's' : ''}`);
//     }
    
//     // Check for projects with low completion rates
//     const projectRates = this.getCompletionRateByProject(user);
//     projectRates.forEach(rate => {
//       if (rate.completionRate < 30 && rate.completionRate > 0) {
//         bottlenecks.push(`Project "${rate.projectName}" has low completion rate (${rate.completionRate}%)`);
//       }
//     });
    
//     return bottlenecks;
//   }
// }

// analytics.service.ts
// ================================================================
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface SeriesEntry {
  tag: string;
  data: number[]; // Assuming 'arr' which comes from 'countsByTag' is an array of numbers.
}
export interface CompletedPerDayResponse {
  labels: string[];
  series: SeriesEntry[];
}

export interface CompletionRateByTagResponse {
  labels: string[];
  values: number[];
  counts: { total: number; onTime: number; late: number }[];
}
@Injectable({ providedIn: 'root' })


export class AnalyticsService {
  constructor(private http: HttpClient) {}

  getCompletedPerDay(days = 30,username: string): Observable<CompletedPerDayResponse> {
    return this.http.get<CompletedPerDayResponse>(`http://localhost:3000/analytics/completed-per-day?days=${days}&username=${username}`);
  }

  getCompletionRateByTag(days = 30,username:string): Observable<CompletionRateByTagResponse> {
    return this.http.get<CompletionRateByTagResponse>(`http://localhost:3000/analytics/completion-rate-by-tag?days=${days}&username=${username}`);
  }
}
//=============================================================
// import { Injectable } from '@angular/core';
// @Injectable({
//   providedIn: 'root'
// })
// export class AnalyticsService {

//   // tasks is an array from your JSON loader
//   computeTasksPerDayByTag(tasks: any[]) {
//     const result: Record<string, Record<string, number>> = {};

//     tasks.forEach(task => {
//       if (!task.completedAt || !task.tag) return;

//       const day = task.completedAt.slice(0, 10); // YYYY-MM-DD
//       const tag = task.tag;

//       if (!result[tag]) result[tag] = {};
//       if (!result[tag][day]) result[tag][day] = 0;

//       result[tag][day]++;
//     });

//     return result;
//   }


//   computeTagCompletionRates(tasks: any[]) {
//     const stats: Record<string, { total: number, onTime: number }> = {};

//     tasks.forEach(task => {
//       if (!task.tag) return;
//       const tag = task.tag;

//       if (!stats[tag]) stats[tag] = { total: 0, onTime: 0 };
//       stats[tag].total++;

//       if (task.completedAt && task.deadline &&
//           new Date(task.completedAt) <= new Date(task.deadline)) {
//         stats[tag].onTime++;
//       }
//     });

//     // Convert to percentage form
//     const percentages = Object.keys(stats).map(tag => {
//       const { total, onTime } = stats[tag];
//       return {
//         tag,
//         percentage: total ? Math.round((onTime / total) * 100) : 0,
//         total,
//         onTime
//       };
//     });

//     return percentages;
//   }
// }
