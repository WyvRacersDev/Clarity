import { ChangeDetectorRef, Component, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { AIService, AIProjectScope } from '../../services/ai.service';
import { DataService } from '../../services/data.service';
import { isLocalhostServer } from '../../config/server.config';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { marked } from 'marked';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/** E9 — a project-aware quick action surfaced as a chip in the Assistant. */
interface AssistantAction {
  key: string;
  label: string;      // shown on the chip
  userText: string;   // friendly bubble shown as the "user" turn
  prompt: string;     // actual instruction sent to the model
}

@Component({
  selector: 'app-assistant',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './assistant.component.html',
  styleUrl: './assistant.component.css'
})
export class AssistantComponent implements OnInit, OnDestroy {
  aiChatMessages: { role: 'user' | 'ai'; content: string }[] = [];
  userInput = '';
  isLoading = false;
  // True while a streamed assistant reply is being received (C3): shows the
  // typing indicator and lets the last AI bubble grow token-by-token.
  isStreaming = false;
  // Handle to the in-flight stream subscription so a Stop button can abort it.
  private streamSub?: Subscription;
  private subs: Subscription[] = [];
  validCommands = [
    'Summarize project ',
    'Suggest schedule for project',
    'Send an invite to '
  ];
  showCommandDropdown = false;
  filteredCommands: string[] = [];
  cursorPosition = 0;
  highlightedInput: SafeHtml = '';

  // E9 — project scope: the assistant grounds answers/actions in the selected
  // project. Empty selection = generic assistant (unchanged behavior).
  projects: AIProjectScope[] = [];
  selectedProjectName = '';
  loadingProjects = false;

  // E9 — project-aware quick actions (read-only; stream a grounded reply).
  readonly actions: AssistantAction[] = [
    {
      key: 'summarize',
      label: 'Summarize project',
      userText: 'Summarize this project',
      prompt:
        'Give me a concise summary of this project: its lists, overall progress, ' +
        'and a short timeline of tasks with their deadlines and completion status.',
    },
    {
      key: 'blocked',
      label: "What's blocked?",
      userText: "What's blocked or at risk?",
      prompt:
        "What's blocked, overdue, or at risk in this project? List overdue tasks " +
        '(most urgent first), tasks with no due date, stalled in-progress work, and ' +
        'any lists blocked by other lists. Be specific and reference tasks by name.',
    },
  ];

  constructor(
    private aiService: AIService,
    private dataService: DataService,
    private sanitizer: DomSanitizer,
    private cd: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) { }

  ngOnInit(): void {
    this.updateHighlightedInput();
    this.loadProjects();
  }

  /**
   * Load the user's projects for the scope picker. Mirrors ProjectsComponent:
   * hosted always, local only when the server is localhost. Best-effort — the
   * assistant still works generically if this fails.
   */
  private async loadProjects(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadingProjects = true;
    try {
      const loads = [this.dataService.listProjects('hosted')];
      if (isLocalhostServer()) loads.push(this.dataService.listProjects('local'));
      const results = await Promise.all(loads);
      const seen = new Set<string>();
      this.projects = results
        .flat()
        .map((p) => ({ name: p.name, type: (p as any).projectType as 'local' | 'hosted' }))
        .filter((p) => p.name && !seen.has(`${p.type}:${p.name}`) && seen.add(`${p.type}:${p.name}`));
    } catch (err) {
      console.error('[Assistant] Failed to load projects for scope picker:', err);
    } finally {
      this.loadingProjects = false;
      this.cd.detectChanges();
    }
  }

  /** The currently selected project as a scope, or undefined for generic chat. */
  private currentScope(): AIProjectScope | undefined {
    if (!this.selectedProjectName) return undefined;
    return this.projects.find((p) => p.name === this.selectedProjectName);
  }

  /** Run a project-aware quick action (E9). Requires a selected project. */
  async runAction(action: AssistantAction): Promise<void> {
    if (this.isLoading || this.isStreaming) return;
    const scope = this.currentScope();
    if (!scope) return;

    this.aiChatMessages.push({ role: 'user', content: `${action.userText} — ${scope.name}` });
    const canStream = isPlatformBrowser(this.platformId) && typeof fetch !== 'undefined';
    if (canStream) {
      await this.streamMessage(action.prompt, scope);
    } else {
      await this.blockingMessage(action.prompt, scope);
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.streamSub?.unsubscribe();
  }

  /** True once at least one turn has been exchanged (drives the Clear button). */
  hasConversation(): boolean {
    return this.aiChatMessages.length > 0 || this.isStreaming;
  }

  /** Clear the transcript (ported from B's assistant "Clear chat" action). */
  clearChat(): void {
    if (this.isLoading || this.isStreaming) return;
    this.aiChatMessages = [];
    this.cd.detectChanges();
  }

  /** Abort an in-flight streamed reply (ported from B's assistant "Stop"). */
  stop(): void {
    if (!this.isStreaming) return;
    // Unsubscribing triggers the stream teardown (aborts the fetch).
    this.streamSub?.unsubscribe();
    this.streamSub = undefined;
    this.isStreaming = false;
    this.isLoading = false;
    this.cd.detectChanges();
  }

  async sendMessage(): Promise<void> {
    console.log('sendMessage called');
    if (!this.userInput.trim()) return;

    const userMessage = this.userInput.trim();
    this.userInput = '';
    this.highlightedInput = '';

    this.aiChatMessages.push({
      role: 'user',
      content: userMessage,
    });

    // E9: ground the reply in the selected project (if any).
    const scope = this.currentScope();

    // C3: prefer streaming; fall back to the blocking request if streaming is
    // unavailable (SSR / no fetch) or errors out before any token arrives.
    const canStream =
      isPlatformBrowser(this.platformId) && typeof fetch !== 'undefined';
    if (canStream) {
      await this.streamMessage(userMessage, scope);
    } else {
      await this.blockingMessage(userMessage, scope);
    }
  }

  /**
   * C3: render the assistant reply token-by-token. Accumulates raw text, keeps
   * the last AI bubble in sync (markdown-rendered each tick), and shows the
   * typing indicator until the first token lands.
   */
  private async streamMessage(userMessage: string, scope?: AIProjectScope): Promise<void> {
    this.isLoading = true;
    this.isStreaming = true;

    // Reserve the assistant bubble; grow its content as chunks arrive.
    const aiIndex = this.aiChatMessages.push({ role: 'ai', content: '' }) - 1;
    let raw = '';
    let gotAnyToken = false;
    let stopped = false;

    marked.setOptions({ async: false });

    await new Promise<void>((resolve) => {
      const sub = this.aiService.streamChat(userMessage, scope).subscribe({
        next: (ev) => {
          if (ev.type === 'chunk') {
            gotAnyToken = true;
            this.isLoading = false; // first token — hide "typing" dots
            raw += ev.text;
            this.aiChatMessages[aiIndex].content = marked.parse(raw) as string;
            this.cd.detectChanges();
          } else if (ev.type === 'error') {
            // If nothing streamed yet, drop the empty bubble and fall back.
            if (!gotAnyToken) {
              this.aiChatMessages.splice(aiIndex, 1);
            }
          }
        },
        error: () => {
          if (!gotAnyToken) this.aiChatMessages.splice(aiIndex, 1);
          resolve();
        },
        complete: () => resolve(),
      });
      this.streamSub = sub;
      this.subs.push(sub);
      // If the user hit Stop, unsubscribe already fired; make sure we resolve.
      if (sub.closed) {
        stopped = true;
        resolve();
      }
    });

    this.streamSub = undefined;

    // If Stop was pressed mid-stream, keep whatever streamed and bail out.
    if (!this.isStreaming) {
      if (!gotAnyToken) this.aiChatMessages.splice(aiIndex, 1);
      return;
    }

    this.isStreaming = false;
    this.isLoading = false;

    if (gotAnyToken) {
      this.aiService.recordAssistantMessage(raw);
      this.cd.detectChanges();
    } else if (!stopped) {
      // Streaming produced nothing — use the reliable blocking path.
      await this.blockingMessage(userMessage, scope);
    }
  }

  /** Original non-streaming path, kept as a fallback (C3). */
  private async blockingMessage(userMessage: string, scope?: AIProjectScope): Promise<void> {
    try {
      this.isLoading = true;
      const response = await firstValueFrom(
        this.aiService.chat(userMessage, scope)
      );
      this.isLoading = false;
      console.log('AI response received:', response);
      marked.setOptions({ async: false });
      const htmlString = marked.parse(response) as string;
      this.aiChatMessages.push({ role: 'ai', content: htmlString });
      this.cd.detectChanges();
    } catch (err: any) {
      this.isLoading = false;
      console.error('Error getting AI response:', err);
      if (err.status === 429 || err.code === 429) {
        this.aiChatMessages.push({
          role: 'ai',
          content: 'Rate limit exceeded. Please try again later.',
        });
      }
      else if (err.status === 400 || err.code === 400) {
        this.aiChatMessages.push({
          role: 'ai',
          content: 'Unauthorized access to AI service. Please check your API model.',
        });
      }
      else if (err.status === 401 || err.code === 401) {
        this.aiChatMessages.push({
          role: 'ai',
          content: 'Unauthorized access to AI service. Please check your API credentials.',
        });
      }
      else if (err.status === 500 || err.code === 500) {
        this.aiChatMessages.push({
          role: 'ai',
          content: 'Something went wrong with the AI service. Please try again later.',
        });
      } else {
        this.aiChatMessages.push({
          role: 'ai',
          content: 'Sorry, I encountered an error. Please try again.',
        });
      }
      this.isLoading = false;
      this.cd.detectChanges();
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

    // Move cursor to end (SSR-safe)
    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => {
        const input = document.querySelector('.chat-input') as HTMLInputElement;
        if (input) input.setSelectionRange(newText.length, newText.length);
      });
    }
  }

  updateHighlightedInput() {
    let html = this.userInput;

    this.validCommands.forEach(cmd => {
      const escaped = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Match @ + command case-insensitive
      const regex = new RegExp(`@${escaped}`, 'gi');

      html = html.replace(regex, `<span class="highlight-command">@${cmd}</span>`);
    });

    this.highlightedInput = this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
