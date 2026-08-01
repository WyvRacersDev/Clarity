import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatTarget } from '../../services/chat.service';
import { ChatListComponent } from './chat-list.component';
import { ChatConversationComponent } from './chat-conversation.component';

/**
 * MessagesPageComponent — the full-page chat surface (route /dashboard/messages).
 *
 * A two-pane layout: the shared ChatListComponent on the left, the shared
 * ChatConversationComponent on the right. Both panes reuse the same components
 * as the slide-in panel (DRY); this page only owns the selected conversation.
 */
@Component({
  selector: 'app-messages-page',
  standalone: true,
  imports: [CommonModule, ChatListComponent, ChatConversationComponent],
  template: `
    <div class="messages-page">
      <aside class="rail">
        <div class="rail-head">Conversations</div>
        <app-chat-list (select)="select($event)" />
      </aside>
      <section class="pane">
        @if (target(); as t) {
          <div class="pane-head">{{ t.scope === 'dm' ? t.to : (t.projectName + ' · team') }}</div>
          <div class="pane-body">
            <app-chat-conversation [target]="t" [meetEnabled]="t.scope === 'project'" />
          </div>
        } @else {
          <div class="pane-empty">
            <p class="pane-empty-title">Your messages</p>
            <p class="pane-empty-sub">Pick a conversation or start a new one.</p>
          </div>
        }
      </section>
    </div>
  `,
  styles: [`
    .messages-page { display:grid; grid-template-columns:320px 1fr; height:calc(100vh - 120px);
      min-height:480px; border:1px solid var(--border); border-radius:var(--radius-lg);
      overflow:hidden; background:var(--surface-1, var(--bg-secondary)); }
    .rail { border-right:1px solid var(--border); display:flex; flex-direction:column; min-height:0; }
    .rail-head { flex:0 0 auto; padding:var(--space-4); font-weight:700; color:var(--text-primary);
      border-bottom:1px solid var(--border); }
    app-chat-list { flex:1; min-height:0; }
    .pane { display:flex; flex-direction:column; min-width:0; }
    .pane-head { flex:0 0 auto; padding:var(--space-4); font-weight:700; color:var(--text-primary);
      border-bottom:1px solid var(--border); }
    .pane-body { flex:1; min-height:0; }
    app-chat-conversation { display:flex; flex-direction:column; height:100%; min-height:0; }
    .pane-empty { margin:auto; text-align:center; color:var(--text-muted); }
    .pane-empty-title { font-weight:700; color:var(--text-secondary); margin:0 0 4px; font-size:var(--text-lg); }
    .pane-empty-sub { margin:0; }
    @media (max-width: 720px) {
      .messages-page { grid-template-columns:1fr; }
      .pane { display:none; }
    }
  `],
})
export class MessagesPageComponent {
  readonly target = signal<ChatTarget | null>(null);

  select(target: ChatTarget): void {
    this.target.set(target);
  }
}
