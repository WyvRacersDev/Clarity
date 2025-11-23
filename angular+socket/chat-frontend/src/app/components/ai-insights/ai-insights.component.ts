import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { User } from '../../../../../shared_models/models/user.model';
import { Project } from '../../../../../shared_models/models/project.model';
import { scheduled_task, ToDoLst, Screen_Element } from '../../../../../shared_models/models/screen_elements.model';
import { Grid } from '../../../../../shared_models/models/project.model';
import dayjs from 'dayjs';

@Component({
  selector: 'app-ai-insights',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-insights.component.html',
  styleUrls: ['./ai-insights.component.css']
})
export class AiInsightsComponent implements OnInit {
  currentUser: User | null = null;
  insights: string[] = [];
  bottlenecks: string[] = [];
  suggestions: string[] = [];
  aiChatMessages: { role: 'user' | 'ai'; content: string }[] = [];
  userInput = '';
  isLoading = false;

  constructor(private dataService: DataService) {}

  ngOnInit(): void {
    this.dataService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.analyzeProductivity();
    });
  }

  analyzeProductivity(): void {
    if (!this.currentUser) return;

    this.insights = [];
    this.bottlenecks = [];
    this.suggestions = [];

    let totalTasks = 0;
    let completedTasks = 0;
    let overdueTasks = 0;
    const now = dayjs();

    this.currentUser.projects.forEach((project: Project) => {
      if (project.grid && Array.isArray(project.grid)) {
        project.grid.forEach((grid: Grid) => {
          if (grid.Screen_elements && Array.isArray(grid.Screen_elements)) {
            grid.Screen_elements.forEach((element: Screen_Element) => {
              if (element && element.constructor.name === 'ToDoLst') {
                const todoList = element as ToDoLst;
                if (todoList.scheduled_tasks && Array.isArray(todoList.scheduled_tasks)) {
                  todoList.scheduled_tasks.forEach((task: scheduled_task) => {
                    if (task) {
                      totalTasks++;
                      if (task.get_status()) {
                        completedTasks++;
                      } else {
                        const taskDate = dayjs(task.get_time());
                        if (taskDate.isBefore(now)) {
                          overdueTasks++;
                        }
                      }
                    }
                  });
                }
              }
            });
          }
        });
      }
    });

    // Generate insights
    if (totalTasks > 0) {
      const completionRate = (completedTasks / totalTasks) * 100;
      this.insights.push(`You have completed ${completionRate.toFixed(1)}% of your tasks.`);
      
      if (completionRate >= 80) {
        this.insights.push('Excellent productivity! You\'re maintaining a high completion rate.');
      } else if (completionRate >= 60) {
        this.insights.push('Good progress! Consider focusing on task prioritization.');
      } else {
        this.insights.push('There\'s room for improvement. Try breaking down larger tasks.');
      }
    }

    // Identify bottlenecks
    if (overdueTasks > 0) {
      this.bottlenecks.push(`You have ${overdueTasks} overdue task(s). Consider reviewing and rescheduling them.`);
    }

    if (this.currentUser.projects.length === 0) {
      this.bottlenecks.push('No projects created yet. Start organizing your work into projects.');
    }

    // Generate suggestions
    if (totalTasks > 10 && completedTasks / totalTasks < 0.7) {
      this.suggestions.push('Consider using the priority system more effectively. Focus on high-priority tasks first.');
    }

    if (overdueTasks > 3) {
      this.suggestions.push('You have multiple overdue tasks. Try scheduling buffer time between tasks.');
    }

    if (this.currentUser.projects.length < 2) {
      this.suggestions.push('Organize your work into multiple projects for better structure.');
    }

    // Add default suggestions if none
    if (this.suggestions.length === 0) {
      this.suggestions.push('Keep up the great work! Maintain your current productivity patterns.');
    }
  }

  sendMessage(): void {
    if (!this.userInput.trim()) return;

    this.aiChatMessages.push({ role: 'user', content: this.userInput });
    const userMessage = this.userInput;
    this.userInput = '';
    this.isLoading = true;

    // Simulate AI response (in real implementation, this would call an AI service)
    setTimeout(() => {
      let response = '';
      const lowerInput = userMessage.toLowerCase();

      if (lowerInput.includes('schedule') || lowerInput.includes('calendar')) {
        response = 'I can help you schedule tasks. Would you like me to suggest optimal times based on your current workload?';
      } else if (lowerInput.includes('task') || lowerInput.includes('todo')) {
        response = 'Based on your task history, I recommend focusing on high-priority items first. Would you like me to identify your most important tasks?';
      } else if (lowerInput.includes('productivity') || lowerInput.includes('improve')) {
        response = 'Your productivity analysis shows good progress. Consider breaking down large tasks and using time-blocking techniques.';
      } else {
        response = 'I\'m here to help with task management, scheduling, and productivity insights. How can I assist you today?';
      }

      this.aiChatMessages.push({ role: 'ai', content: response });
      this.isLoading = false;
    }, 1000);
  }
}

