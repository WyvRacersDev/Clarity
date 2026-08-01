import { Injectable,PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { User } from '../../../../shared_models/models/user.model';
import { AnalyticsService } from './analytics.service';
import { DataService } from './data.service';
import { Observable, tap, map, firstValueFrom } from 'rxjs';
import { getServerConfig } from '../config/server.config';
import { authHeaders } from '../config/auth-token';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/** E9 — optional project the assistant should ground its answer/actions in. */
export interface AIProjectScope {
  name: string;
  type?: 'local' | 'hosted';
}

/** One event from the streaming chat: an incremental token, or the terminal. */
export type AIStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** Proactive scheduling suggestion payload (mirrors the backend `ai:suggestion`). */
export interface AISuggestion {
  type: 'proactive_schedule';
  text: string;
  taskCount: number;
  overdueCount: number;
  missingDueCount: number;
  generatedAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class AIService {
    chatHistory: AIMessage[] = [];

  constructor(private analyticsService: AnalyticsService,
    private http: HttpClient,
    private dataService: DataService,
    
  ) {this.loadInitialData();}
  loadInitialData():void{
    if(!isPlatformBrowser(PLATFORM_ID)) return;
    if(this.dataService.getCurrentUser()==null) return;
  }

 chat(input: string, scope?: AIProjectScope): Observable<string> {
        // Add user message to history
    console.log("Sending to AIService chat:", input);
        this.chatHistory.push({
      role: 'user',
      content: input,
      timestamp: new Date()
    });
    console.log("Current user in AIService chat:", this.dataService.getCurrentUser());
    const username = this.dataService.getCurrentUser()?.name ?? 'Demo User';
    const url =
      `${getServerConfig()}/ai-assistant/chat-agent` +
      `?username=${encodeURIComponent(username)}&input=${encodeURIComponent(input)}` +
      this.scopeQuery(scope);
    return this.http.get<string>(url, { headers: authHeaders() }).pipe(
      tap((response: string) => {
        this.chatHistory.push({
          role: 'assistant',
          content: response,
          timestamp: new Date()
        });
      })
    );
  }


  /**
   * Streaming chat (C3). Emits incremental `chunk` events as tokens arrive,
   * then a terminal `done` (or `error`). Uses the fetch + ReadableStream API
   * (not EventSource) so we can POST-free GET with the app's server config and
   * cleanly abort on unsubscribe. SSR-safe: no-ops with an `error` if `fetch`
   * is unavailable, so callers can fall back to the blocking `chat()`.
   *
   * The user message is pushed to history immediately; the assistant message is
   * NOT pushed here (the component owns incremental rendering + final history).
   */
  /** Build the optional `&projectName=&projectType=` scope query fragment (E9). */
  private scopeQuery(scope?: AIProjectScope): string {
    if (!scope?.name) return '';
    let q = `&projectName=${encodeURIComponent(scope.name)}`;
    if (scope.type) q += `&projectType=${encodeURIComponent(scope.type)}`;
    return q;
  }

  streamChat(input: string, scope?: AIProjectScope): Observable<AIStreamEvent> {
    console.log('Streaming to AIService chat:', input);
    this.chatHistory.push({ role: 'user', content: input, timestamp: new Date() });

    return new Observable<AIStreamEvent>((subscriber) => {
      if (typeof fetch === 'undefined' || typeof AbortController === 'undefined') {
        subscriber.next({ type: 'error', message: 'Streaming unavailable' });
        subscriber.complete();
        return;
      }

      const username = this.dataService.getCurrentUser()?.name ?? 'Demo User';
      const url =
        `${getServerConfig()}/ai-assistant/chat-agent-stream` +
        `?username=${encodeURIComponent(username)}&input=${encodeURIComponent(input)}` +
        this.scopeQuery(scope);

      const controller = new AbortController();

      (async () => {
        try {
          const res = await fetch(url, {
            headers: { Accept: 'text/event-stream', ...authHeaders() },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) {
            subscriber.next({
              type: 'error',
              message: `Stream failed (${res.status})`,
            });
            subscriber.complete();
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          // Parse the SSE frame stream. Events are separated by a blank line;
          // each has `event:` and/or `data:` lines. `data:` holds a JSON string.
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let sep: number;
            while ((sep = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);

              let eventName = 'message';
              let dataRaw = '';
              for (const line of frame.split('\n')) {
                if (line.startsWith('event:')) eventName = line.slice(6).trim();
                else if (line.startsWith('data:')) dataRaw += line.slice(5).trim();
              }

              if (eventName === 'done') {
                subscriber.next({ type: 'done' });
                subscriber.complete();
                return;
              }
              if (eventName === 'error') {
                let message = 'The AI service failed while streaming.';
                try {
                  message = JSON.parse(dataRaw)?.message ?? message;
                } catch { /* keep default */ }
                subscriber.next({ type: 'error', message });
                subscriber.complete();
                return;
              }
              // Default `message` event: a JSON-encoded token chunk.
              if (dataRaw) {
                try {
                  const text = JSON.parse(dataRaw);
                  if (typeof text === 'string' && text) {
                    subscriber.next({ type: 'chunk', text });
                  }
                } catch { /* ignore malformed frame */ }
              }
            }
          }
          subscriber.next({ type: 'done' });
          subscriber.complete();
        } catch (err: any) {
          if (controller.signal.aborted) return; // unsubscribed — stay silent
          subscriber.next({
            type: 'error',
            message: err?.message ?? 'Streaming error',
          });
          subscriber.complete();
        }
      })();

      // Teardown: abort the in-flight fetch if the caller unsubscribes.
      return () => controller.abort();
    });
  }

  /**
   * Push the final assistant reply into history once streaming completes, so a
   * later `chat()` call has coherent context (kept symmetric with `chat()`).
   */
  recordAssistantMessage(content: string): void {
    this.chatHistory.push({ role: 'assistant', content, timestamp: new Date() });
  }

  /**
   * On-demand pull of the proactive scheduling suggestion (C2 fallback for the
   * Socket.IO push). Returns `null` when the user has no overdue/undated tasks.
   */
  getSuggestion(): Observable<AISuggestion | null> {
    const username = this.dataService.getCurrentUser()?.name ?? '';
    return this.http
      .get<{ suggestion: AISuggestion | null }>(
        `${getServerConfig()}/ai-assistant/suggestions?username=${encodeURIComponent(username)}`,
        { headers: authHeaders() }
      )
      // Unwrap the envelope so callers get the suggestion (or null) directly.
      .pipe(map((res) => res?.suggestion ?? null));
  }

  /**
   * E9 (slice 2) — turn a chat conversation into tasks in a project. Sends the
   * serialized thread text; the backend extracts action items and creates them.
   * Returns the summary + created task names (count for the UI).
   */
  threadToTasks(
    projectName: string,
    projectType: 'local' | 'hosted' | undefined,
    thread: string
  ): Promise<{ message: string; created: string[]; count: number }> {
    return firstValueFrom(
      this.http.post<{ message: string; created: string[]; count: number }>(
        `${getServerConfig()}/ai-assistant/thread-to-tasks`,
        { projectName, projectType, thread },
        { headers: authHeaders() }
      )
    );
  }

  getChatHistory(): AIMessage[] {
    return this.chatHistory;
  }

  clearChatHistory(): void {
    this.chatHistory = [];
  }
}

