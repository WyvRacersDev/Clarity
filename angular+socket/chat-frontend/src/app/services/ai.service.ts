// import { Injectable } from '@angular/core';
// import { User } from '../../../../shared_models/models/user.model';
// import { AnalyticsService } from './analytics.service';

// export interface AIMessage {
//   role: 'user' | 'assistant';
//   content: string;
//   timestamp: Date;
// }

// @Injectable({
//   providedIn: 'root'
// })
// export class AIService {
//   private chatHistory: AIMessage[] = [];

//   constructor(private analyticsService: AnalyticsService) {}

//   async sendMessage(userInput: string, user: User | null): Promise<string> {
//     if (!user) {
//       return 'Please log in to use the AI assistant.';
//     }

//     // Add user message to history
//     this.chatHistory.push({
//       role: 'user',
//       content: userInput,
//       timestamp: new Date()
//     });

//     // Process the message and generate response
//     const response = await this.processMessage(userInput.toLowerCase(), user);
    
//     // Add assistant response to history
//     this.chatHistory.push({
//       role: 'assistant',
//       content: response,
//       timestamp: new Date()
//     });

//     return response;
//   }

//   private async processMessage(input: string, user: User): Promise<string> {
//     // Analyze task history
//     if (input.includes('analyze') || input.includes('productivity') || input.includes('performance')) {
//       const bottlenecks = this.analyticsService.identifyBottlenecks(user);
//       const score = this.analyticsService.calculateProductivityScore(
//         this.getTotalTasks(user),
//         this.getCompletedTasks(user)
//       );

//       if (bottlenecks.length > 0) {
//         return `Your productivity score is ${score}%. I've identified some bottlenecks:\n\n${bottlenecks.map(b => `• ${b}`).join('\n')}\n\nWould you like suggestions on how to improve these areas?`;
//       } else {
//         return `Great news! Your productivity score is ${score}%. I don't see any major bottlenecks. Keep up the excellent work! 🎉`;
//       }
//     }

//     // Task scheduling
//     if (input.includes('schedule') || input.includes('remind') || input.includes('task')) {
//       return 'I can help you schedule tasks! You can:\n• Create new tasks with specific dates and priorities\n• Set reminders for important deadlines\n• Organize tasks by project\n\nWould you like me to create a task for you?';
//     }

//     // Project insights
//     if (input.includes('project') || input.includes('progress')) {
//       const projectRates = this.analyticsService.getCompletionRateByProject(user);
//       if (projectRates.length === 0) {
//         return 'You don\'t have any projects yet. Would you like help creating your first project?';
//       }
      
//       const summary = projectRates.map(p => 
//         `• ${p.projectName}: ${p.completionRate}% complete`
//       ).join('\n');
      
//       return `Here's your project progress:\n\n${summary}\n\nWhich project would you like to focus on?`;
//     }

//     // General help
//     if (input.includes('help') || input.includes('what can you do')) {
//       return `I'm your AI productivity assistant! I can help you with:\n\n• Analyzing your productivity and identifying bottlenecks\n• Scheduling tasks and setting reminders\n• Providing insights on your project progress\n• Suggesting improvements to your workflow\n• Answering questions about your tasks and projects\n\nWhat would you like help with today?`;
//     }

//     // Default response
//     return 'I understand you\'re asking about: "' + input + '". I can help you with productivity analysis, task scheduling, project insights, and workflow improvements. What specific help do you need?';
//   }

//   private getTotalTasks(user: User): number {
//     let count = 0;
//     user.projects.forEach(project => {
//       project.grid.forEach(grid => {
//         grid.Screen_elements.forEach(element => {
//           if (element.constructor.name === 'ToDoLst') {
//             const todoList = element as any;
//             if (todoList.scheduled_tasks) {
//               count += todoList.scheduled_tasks.length;
//             }
//           }
//         });
//       });
//     });
//     return count;
//   }

//   private getCompletedTasks(user: User): number {
//     let count = 0;
//     user.projects.forEach(project => {
//       project.grid.forEach(grid => {
//         grid.Screen_elements.forEach(element => {
//           if (element.constructor.name === 'ToDoLst') {
//             const todoList = element as any;
//             if (todoList.scheduled_tasks) {
//               count += todoList.scheduled_tasks.filter((t: any) => t.is_done).length;
//             }
//           }
//         });
//       });
//     });
//     return count;
//   }

//   getChatHistory(): AIMessage[] {
//     return this.chatHistory;
//   }

//   clearChatHistory(): void {
//     this.chatHistory = [];
//   }
// }

