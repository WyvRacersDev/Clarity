import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, firstValueFrom } from 'rxjs';
import { SocketService } from './socket.service';

/**
 * ChatService — thin Angular wrapper over the Socket.IO chat contract.
 *
 * Mirrors CollabService's shape: ack-based emits become Promises, broadcasts
 * become Observables, and everything is a safe no-op during SSR. A conversation
 * is addressed by a `ChatTarget` — a project channel or a 1:1 DM — which this
 * service turns into the wire payload the backend expects.
 *
 * Backend contract (see socket-server chat.gateway.ts):
 *   chat:send     { scope, projectName?, projectType?, to?, body, replyToId? }
 *   chat:history  { scope, ..., before?, limit? }         -> { messages }
 *   chat:edit     { scope, ..., id, body }                -> { message }
 *   chat:delete   { scope, ..., id }                      -> { id }
 *   chat:read     { scope, ... }                          -> { success }
 *   chat:unread   { projectName, projectType }            -> { count }
 *   chat:conversations {}                                 -> { conversations }
 * Broadcasts: chat:message, chat:message:updated, chat:message:deleted, chat:typing
 */
export type ProjectType = 'local' | 'hosted';

/** A message row (mirrors the backend SerializedMessage). */
export interface ChatMessage {
  id: string;
  scope: 'project' | 'dm';
  projectId: string | null;
  dmKey: string | null;
  author: string;
  body: string;
  replyToId: string | null;
  edited_at: string | null;
  created_at: string; // ISO 8601
}

/** One DM conversation summary (for the Messages page list). */
export interface DmConversation {
  partner: string;
  dmKey: string;
  lastBody: string;
  lastAt: string;
  unread: number;
}

/** Addresses a conversation: a project channel or a 1:1 DM partner. */
export type ChatTarget =
  | { scope: 'project'; projectName: string; projectType: ProjectType }
  | { scope: 'dm'; to: string };

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly isBrowser: boolean;

  constructor(
    private socket: SocketService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /** Flatten a target into the wire fields the backend reads. */
  private targetPayload(target: ChatTarget): Record<string, any> {
    return target.scope === 'project'
      ? { scope: 'project', projectName: target.projectName, projectType: target.projectType }
      : { scope: 'dm', to: target.to };
  }

  // --- Send / edit / delete --------------------------------------------------

  /** Post a message to a conversation. Resolves the created message or throws. */
  async send(target: ChatTarget, body: string, replyToId?: string): Promise<ChatMessage> {
    if (!this.isBrowser) throw new Error('Chat unavailable (SSR)');
    const payload = { ...this.targetPayload(target), body, ...(replyToId ? { replyToId } : {}) };
    const ack = await firstValueFrom(this.socket.chatSend(payload));
    if (ack?.success) return ack.message as ChatMessage;
    throw new Error(ack?.message || 'Failed to send message');
  }

  /** Edit your own message. Resolves the updated message or throws. */
  async edit(target: ChatTarget, id: string, body: string): Promise<ChatMessage> {
    if (!this.isBrowser) throw new Error('Chat unavailable (SSR)');
    const ack = await firstValueFrom(this.socket.chatEdit({ ...this.targetPayload(target), id, body }));
    if (ack?.success) return ack.message as ChatMessage;
    throw new Error(ack?.message || 'Failed to edit message');
  }

  /** Delete your own message. Resolves true on success. */
  async remove(target: ChatTarget, id: string): Promise<boolean> {
    if (!this.isBrowser) return false;
    const ack = await firstValueFrom(this.socket.chatDelete({ ...this.targetPayload(target), id }));
    if (ack?.success) return true;
    throw new Error(ack?.message || 'Failed to delete message');
  }

  // --- History + unread ------------------------------------------------------

  /** Load a conversation's messages (oldest-first). `before` pages older. */
  async history(target: ChatTarget, before?: string, limit?: number): Promise<ChatMessage[]> {
    if (!this.isBrowser) return [];
    const payload = {
      ...this.targetPayload(target),
      ...(before ? { before } : {}),
      ...(limit ? { limit } : {}),
    };
    const ack = await firstValueFrom(this.socket.chatHistory(payload));
    return ack?.success && Array.isArray(ack.messages) ? (ack.messages as ChatMessage[]) : [];
  }

  /** Mark a conversation read up to now. */
  async markRead(target: ChatTarget): Promise<void> {
    if (!this.isBrowser) return;
    try {
      await firstValueFrom(this.socket.chatRead(this.targetPayload(target)));
    } catch {
      /* best-effort */
    }
  }

  /** Unread count for a project channel. */
  async unreadForProject(projectName: string, projectType: ProjectType): Promise<number> {
    if (!this.isBrowser) return 0;
    try {
      const ack = await firstValueFrom(this.socket.chatUnread(projectName, projectType));
      return ack?.success ? Number(ack.count ?? 0) : 0;
    } catch {
      return 0;
    }
  }

  /** The current user's DM conversations (most-recent first). */
  async conversations(): Promise<DmConversation[]> {
    if (!this.isBrowser) return [];
    try {
      const ack = await firstValueFrom(this.socket.chatConversations());
      return ack?.success && Array.isArray(ack.conversations)
        ? (ack.conversations as DmConversation[])
        : [];
    } catch {
      return [];
    }
  }

  /** Send a typing indicator (fire-and-forget). */
  typing(target: ChatTarget): void {
    if (!this.isBrowser) return;
    this.socket.chatTyping(this.targetPayload(target));
  }

  // --- Live streams ----------------------------------------------------------

  /** A message arrived (`{ message }`). */
  onMessage(): Observable<ChatMessage> {
    return new Observable<ChatMessage>(observer => {
      const sub = this.socket.onChatMessage().subscribe((data: any) => {
        if (data?.message) observer.next(data.message as ChatMessage);
      });
      return () => sub.unsubscribe();
    });
  }

  /** A message was edited (`{ message }`). */
  onMessageUpdated(): Observable<ChatMessage> {
    return new Observable<ChatMessage>(observer => {
      const sub = this.socket.onChatMessageUpdated().subscribe((data: any) => {
        if (data?.message) observer.next(data.message as ChatMessage);
      });
      return () => sub.unsubscribe();
    });
  }

  /** A message was deleted (`{ id }`). */
  onMessageDeleted(): Observable<string> {
    return new Observable<string>(observer => {
      const sub = this.socket.onChatMessageDeleted().subscribe((data: any) => {
        if (data?.id) observer.next(data.id as string);
      });
      return () => sub.unsubscribe();
    });
  }

  /** Someone is typing (`{ scope, from, conversationKey }`). */
  onTyping(): Observable<{ scope: string; from: string; conversationKey: string }> {
    return this.socket.onChatTyping();
  }
}
