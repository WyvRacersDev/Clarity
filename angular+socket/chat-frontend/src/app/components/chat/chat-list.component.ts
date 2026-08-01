import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService, ChatTarget, DmConversation } from '../../services/chat.service';
import { ChatUiService } from '../../services/chat-ui.service';

/**
 * ChatListComponent — the conversation switcher shared by the panel and the
 * Messages page (DRY). Shows the current project's channel (if the app is in a
 * project context, published via ChatUiService) plus the user's DM conversations
 * with unread badges, and a "start a new message" input that DMs a collaborator
 * by username (the backend rejects non-collaborators with a clear message).
 *
 * Emits the chosen `ChatTarget`; the host decides how to display it.
 */
@Component({
  selector: 'app-chat-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="list">
      @if (channel(); as ch) {
        <div class="list-section">
          <div class="list-label">Project</div>
          <button class="conv-item" (click)="pick({ scope: 'project', projectName: ch.projectName, projectType: ch.projectType })">
            <span class="conv-avatar channel">#</span>
            <span class="conv-main">
              <span class="conv-name">{{ ch.label }}</span>
              <span class="conv-sub">Team channel</span>
            </span>
            @if (channelUnread() > 0) { <span class="badge">{{ channelUnread() }}</span> }
          </button>
        </div>
      }

      <div class="list-section">
        <div class="list-label">Direct messages</div>
        @if (loading()) {
          <div class="list-empty">Loading…</div>
        } @else if (conversations().length === 0) {
          <div class="list-empty">No conversations yet</div>
        } @else {
          @for (c of conversations(); track c.dmKey) {
            <button class="conv-item" (click)="pick({ scope: 'dm', to: c.partner })">
              <span class="conv-avatar" [style.background]="colorFor(c.partner)">{{ initial(c.partner) }}</span>
              <span class="conv-main">
                <span class="conv-name">{{ c.partner }}</span>
                <span class="conv-sub">{{ c.lastBody }}</span>
              </span>
              @if (c.unread > 0) { <span class="badge">{{ c.unread }}</span> }
            </button>
          }
        }
      </div>

      <div class="new-dm">
        <input class="input" [(ngModel)]="newPartner" (keydown.enter)="startDm()"
               placeholder="Message a collaborator by username…" aria-label="New message" />
        <button class="btn btn-secondary btn-sm" (click)="startDm()" [disabled]="!newPartner().trim()">Go</button>
      </div>
    </div>
  `,
  styles: [`
    :host { display:block; height:100%; overflow-y:auto; }
    .list { display:flex; flex-direction:column; gap:var(--space-4); padding:var(--space-3); }
    .list-label { font-size:11px; text-transform:uppercase; letter-spacing:.04em;
      color:var(--text-muted); padding:0 var(--space-2) var(--space-2); font-weight:600; }
    .list-empty { padding:var(--space-2) var(--space-3); color:var(--text-muted); font-size:var(--text-sm); }
    .conv-item { display:flex; align-items:center; gap:var(--space-3); width:100%; text-align:left;
      background:none; border:none; padding:8px; border-radius:var(--radius-md); cursor:pointer; color:var(--text-primary); }
    .conv-item:hover { background:var(--surface-hover, var(--surface-2)); }
    .conv-avatar { flex:0 0 auto; width:36px; height:36px; border-radius:var(--radius-full);
      display:grid; place-items:center; color:#fff; font-weight:700; font-size:13px; }
    .conv-avatar.channel { background:var(--accent-primary); }
    .conv-main { flex:1; min-width:0; display:flex; flex-direction:column; }
    .conv-name { font-weight:600; font-size:var(--text-sm); }
    .conv-sub { font-size:12px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .badge { flex:0 0 auto; min-width:18px; height:18px; padding:0 5px; border-radius:9px;
      background:var(--accent-primary); color:#fff; font-size:11px; font-weight:700; display:grid; place-items:center; }
    .new-dm { display:flex; gap:6px; padding:var(--space-2) var(--space-2) var(--space-3); margin-top:auto; }
    .new-dm .input { flex:1; }
    .input { background:var(--bg-input, var(--surface-2)); border:1px solid var(--border);
      border-radius:var(--radius-md); padding:8px 12px; font-size:var(--text-sm); color:var(--text-primary); }
    .input:focus { outline:none; border-color:var(--border-focus, var(--accent-primary)); }
  `],
})
export class ChatListComponent {
  @Output() select = new EventEmitter<ChatTarget>();

  private chat = inject(ChatService);
  private chatUi = inject(ChatUiService);

  readonly conversations = signal<DmConversation[]>([]);
  readonly loading = signal(false);
  readonly newPartner = signal('');
  readonly channel = this.chatUi.projectChannel;
  readonly channelUnread = signal(0);

  constructor() {
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.conversations.set(await this.chat.conversations());
      const ch = this.channel();
      if (ch) {
        this.channelUnread.set(await this.chat.unreadForProject(ch.projectName, ch.projectType));
      }
    } finally {
      this.loading.set(false);
    }
  }

  pick(target: ChatTarget): void {
    this.select.emit(target);
  }

  startDm(): void {
    const partner = this.newPartner().trim();
    if (!partner) return;
    this.newPartner.set('');
    this.select.emit({ scope: 'dm', to: partner });
  }

  initial(name: string): string {
    return (name?.charAt(0) || '?').toUpperCase();
  }

  colorFor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return `hsl(${h} 55% 45%)`;
  }
}
