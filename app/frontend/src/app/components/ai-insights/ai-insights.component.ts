import { ChangeDetectorRef, Component, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { AIService, AISuggestion } from '../../services/ai.service';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { SocketService } from '../../services/socket.service';
import { Subscription } from 'rxjs';
import { User } from '../../../../../shared_models/models/user.model';
import { Project } from '../../../../../shared_models/models/project.model';
import { scheduled_task, ToDoLst, Screen_Element } from '../../../../../shared_models/models/screen-elements.model';
import { Grid } from '../../../../../shared_models/models/project.model';
import dayjs from 'dayjs';


@Component({
  selector: 'app-ai-insights',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './ai-insights.component.html',
  styleUrls: ['./ai-insights.component.css']
})
export class AiInsightsComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  insights: string[] = [];
  bottlenecks: string[] = [];
  suggestions: string[] = [];
  // Proactive AI suggestions pushed by the server (C2) — rendered in the
  // Suggestions column above the locally-computed heuristics.
  proactiveSuggestions: string[] = [];
  private aiSuggestionHandler?: (payload: AISuggestion) => void;
  private subs: Subscription[] = [];

  constructor(
    private dataService: DataService,
    private aiService: AIService,
    private socketService: SocketService,
    private cd: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) { }

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
    this.subs.push(
      this.dataService.currentUser$.subscribe(user => {
        this.currentUser = user;
        this.analyzeProductivity();
      })
    );

    // C2: surface proactive suggestions without the user asking.
    if (isPlatformBrowser(this.platformId)) {
      this.listenForProactiveSuggestions();
      this.pullProactiveSuggestions();
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    // Detach the raw Socket.IO listener we attached directly.
    const socket = this.socketService.getSocket();
    if (socket && this.aiSuggestionHandler) {
      socket.off('ai:suggestion', this.aiSuggestionHandler);
    }
  }

  /**
   * C2: register for server-pushed `ai:suggestion` events. Uses the raw socket
   * (via getSocket) so we don't need a bespoke wrapper; SSR-safe because the
   * socket is null during server rendering.
   */
  private listenForProactiveSuggestions(): void {
    const socket = this.socketService.getSocket();
    if (!socket) return;
    this.aiSuggestionHandler = (payload: AISuggestion) => {
      this.applyProactiveSuggestion(payload);
      this.cd.detectChanges();
    };
    socket.on('ai:suggestion', this.aiSuggestionHandler);
  }

  /** C2: one-shot pull so suggestions appear immediately, not only on cron. */
  private pullProactiveSuggestions(): void {
    this.subs.push(
      this.aiService.getSuggestion().subscribe({
        next: (s) => {
          if (s) {
            this.applyProactiveSuggestion(s);
            this.cd.detectChanges();
          }
        },
        error: () => { /* non-fatal: keep local heuristics */ },
      })
    );
  }

  /** Split a suggestion payload into lines for the Suggestions column. */
  private applyProactiveSuggestion(payload: AISuggestion): void {
    const lines = payload.text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    // Replace (not append) so re-pushes don't stack duplicates.
    this.proactiveSuggestions = lines;
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
              if (element && this.isTodoListElement(element)) {
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
}
