import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AIMessage, AIService } from '../../services/ai.service';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { User } from '../../../../../shared_models/models/user.model';
import { Project } from '../../../../../shared_models/models/project.model';
import { scheduled_task, ToDoLst, Screen_Element } from '../../../../../shared_models/models/screen_elements.model';
import { Grid } from '../../../../../shared_models/models/project.model';
import dayjs from 'dayjs';
import { firstValueFrom } from 'rxjs';
import { marked } from "marked";
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';


@Component({
  selector: 'app-ai-insights',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './ai-insights.component.html',
  styleUrls: ['./ai-insights.component.css']
})
export class AiInsightsComponent implements OnInit {
  //  aiChatMessages: AIMessage[] = [];
  currentUser: User | null = null;
  insights: string[] = [];
  bottlenecks: string[] = [];
  suggestions: string[] = [];
  aiChatMessages: { role: 'user' | 'ai'; content: string }[] = [];
  userInput = '';
  isLoading = false;
  validCommands = [
    "Summarize project ",
    "Suggest schedule for project",
    "Send an invite to "
  ];
  showCommandDropdown = false;
  filteredCommands: string[] = [];
  cursorPosition = 0;
  highlightedInput: SafeHtml = "";
 

  constructor(private dataService: DataService, private aiService: AIService, private sanitizer: DomSanitizer
    , private cd: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.dataService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.analyzeProductivity();
    });
    this.updateHighlightedInput();
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

    if (overdueTasks > 0) {
      this.bottlenecks.push(`You have ${overdueTasks} overdue task(s). Consider reviewing and rescheduling them.`);
    }

    if (this.currentUser.projects.length === 0) {
      this.bottlenecks.push('No projects created yet. Start organizing your work into projects.');
    }


    if (totalTasks > 10 && completedTasks / totalTasks < 0.7) {
      this.suggestions.push('Consider using the priority system more effectively. Focus on high-priority tasks first.');
    }

    if (overdueTasks > 3) {
      this.suggestions.push('You have multiple overdue tasks. Try scheduling buffer time between tasks.');
    }

    if (this.currentUser.projects.length < 2) {
      this.suggestions.push('Organize your work into multiple projects for better structure.');
    }


    if (this.suggestions.length === 0) {
      this.suggestions.push('Keep up the great work! Maintain your current productivity patterns.');
    }
  }


  async sendMessage(): Promise<void> {
    console.log("sendMessage called");
    if (!this.userInput.trim()) return;

    const userMessage = this.userInput.trim();
    this.userInput = '';
    this.highlightedInput = "";


    const userMsg = {
      role: 'user',
      content: userMessage,
    };
    this.aiChatMessages.push({
      role: 'user',
      content: userMessage,
    });


    try {
      this.isLoading = true;
      const response = await firstValueFrom(
        this.aiService.chat(userMessage)
      );
      this.isLoading = false;
      console.log("AI response received:", response);
      marked.setOptions({ async: false });
      const htmlString = marked.parse(response) as string;
      this.aiChatMessages.push({ role: "ai", content: htmlString });;
      this.cd.detectChanges();
    } catch (err: any) {
      this.isLoading = false;
      console.error('Error getting AI response:', err);
      if (err.status === 429 || err.code === 429) {
        this.aiChatMessages.push({
          role: 'ai',
          content: "Rate limit exceeded. Please try again later.",

        });
      }


      else if (err.status === 400 || err.code === 400) {
        this.aiChatMessages.push({
          role: 'ai',
          content: "Unauthorized access to AI service. Please check your API model.",

        });
      }


      else if (err.status === 401 || err.code === 401) {
        this.aiChatMessages.push({
          role: 'ai',
          content: "Unauthorized access to AI service. Please check your API credentials.",

        });
      }
      else if (err.status === 500 || err.code === 500) {
        this.aiChatMessages.push({
          role: 'ai',
          content: "Something went wrong with the AI service. Please try again later.",

        });
      } else {
        this.aiChatMessages.push({
          role: 'ai',
          content: 'Sorry, I encountered an error. Please try again.',

        });
      }
      this.isLoading = false;
      this.cd.detectChanges();
    } finally {

    }
  }
  onUserInputChange(event: any) {
    const value = this.userInput;
    this.cursorPosition = event.target.selectionStart;

    // Find the @ being typed
    const match = value.slice(0, this.cursorPosition).match(/@([A-Za-z ]*)$/);

    if (match) {
      const textAfterAt = match[1].toLowerCase();

      this.filteredCommands = this.validCommands.filter(cmd =>
        cmd.toLowerCase().includes(textAfterAt)
      );

      this.showCommandDropdown = this.filteredCommands.length > 0;
    } else {
      this.showCommandDropdown = false;
    }

    this.updateHighlightedInput();
  }
  selectCommand(cmd: string) {
    const textBefore = this.userInput.slice(0, this.cursorPosition);
    const textAfter = this.userInput.slice(this.cursorPosition);

    const newText = textBefore.replace(/@[\w ]*$/, '@' + cmd) + textAfter;

    this.userInput = newText;

    this.showCommandDropdown = false;
    this.updateHighlightedInput();

    // Move cursor to end
    setTimeout(() => {
      const input = document.querySelector('.chat-input') as HTMLInputElement;
      if (input) input.setSelectionRange(newText.length, newText.length);
    });
  }
 
  updateHighlightedInput() {
    let html = this.userInput;

    this.validCommands.forEach(cmd => {
      const escaped = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Match @ + command case-insensitive
      const regex = new RegExp(`@${escaped}`, "gi");

      html = html.replace(regex, `<span class="highlight-command">@${cmd}</span>`);
    });

    this.highlightedInput = this.sanitizer.bypassSecurityTrustHtml(html);
  }


}

