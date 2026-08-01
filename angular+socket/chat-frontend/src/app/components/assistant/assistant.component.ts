import { ChangeDetectorRef, Component, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { AIService } from '../../services/ai.service';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { marked } from 'marked';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

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

  constructor(
    private aiService: AIService,
    private sanitizer: DomSanitizer,
    private cd: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) { }

  ngOnInit(): void {
    this.updateHighlightedInput();
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

    // C3: prefer streaming; fall back to the blocking request if streaming is
    // unavailable (SSR / no fetch) or errors out before any token arrives.
    const canStream =
      isPlatformBrowser(this.platformId) && typeof fetch !== 'undefined';
    if (canStream) {
      await this.streamMessage(userMessage);
    } else {
      await this.blockingMessage(userMessage);
    }
  }

  /**
   * C3: render the assistant reply token-by-token. Accumulates raw text, keeps
   * the last AI bubble in sync (markdown-rendered each tick), and shows the
   * typing indicator until the first token lands.
   */
  private async streamMessage(userMessage: string): Promise<void> {
    this.isLoading = true;
    this.isStreaming = true;

    // Reserve the assistant bubble; grow its content as chunks arrive.
    const aiIndex = this.aiChatMessages.push({ role: 'ai', content: '' }) - 1;
    let raw = '';
    let gotAnyToken = false;
    let stopped = false;

    marked.setOptions({ async: false });

    await new Promise<void>((resolve) => {
      const sub = this.aiService.streamChat(userMessage).subscribe({
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
      await this.blockingMessage(userMessage);
    }
  }

  /** Original non-streaming path, kept as a fallback (C3). */
  private async blockingMessage(userMessage: string): Promise<void> {
    try {
      this.isLoading = true;
      const response = await firstValueFrom(
        this.aiService.chat(userMessage)
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
