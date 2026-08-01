import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatUiService } from '../../services/chat-ui.service';
import { ChatTarget } from '../../services/chat.service';
import { ChatListComponent } from './chat-list.component';
import { ChatConversationComponent } from './chat-conversation.component';

/**
 * ChatPanelComponent — the slide-in chat surface, mounted once in the layout.
 *
 * It is a thin shell over ChatUiService state: when a conversation is active it
 * shows ChatConversationComponent; otherwise it shows the ChatListComponent
 * switcher. All the real chat behavior lives in those two reusable pieces, so
 * this component only owns open/close + back navigation + the header.
 */
@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [CommonModule, ChatListComponent, ChatConversationComponent],
  template: `
    @if (chatUi.isOpen()) {
      <div class="scrim" (click)="close()"></div>
      <aside class="panel" role="dialog" aria-label="Chat">
        <header class="panel-head">
          @if (chatUi.activeTarget()) {
            <button class="icon-btn" (click)="back()" title="Back" aria-label="Back to conversations">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          }
          <span class="panel-title">{{ title() }}</span>
          <button class="icon-btn" (click)="close()" title="Close" aria-label="Close chat">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div class="panel-body">
          @if (chatUi.activeTarget(); as target) {
            <app-chat-conversation [target]="target" [meetEnabled]="true" />
          } @else {
            <app-chat-list (select)="open($event)" />
          }
        </div>
      </aside>
    }
  `,
  styles: [`
    .scrim { position:fixed; inset:0; background:rgba(0,0,0,.28); z-index:900; }
    .panel { position:fixed; top:0; right:0; bottom:0; width:min(420px, 100vw); z-index:901;
      display:flex; flex-direction:column; background:var(--surface-1, var(--bg-secondary));
      border-left:1px solid var(--border); box-shadow:var(--shadow-lg);
      animation:slideIn .18s ease-out; }
    @keyframes slideIn { from { transform:translateX(24px); opacity:.6; } to { transform:none; opacity:1; } }
    .panel-head { flex:0 0 auto; display:flex; align-items:center; gap:var(--space-3);
      padding:var(--space-3) var(--space-4); border-bottom:1px solid var(--border); }
    .panel-title { flex:1; font-weight:700; font-size:var(--text-md, 15px); color:var(--text-primary);
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .panel-body { flex:1; min-height:0; display:flex; flex-direction:column; }
    .icon-btn { display:grid; place-items:center; width:32px; height:32px; border-radius:var(--radius-md);
      border:none; background:none; color:var(--text-secondary); cursor:pointer; }
    .icon-btn:hover { background:var(--surface-hover, var(--surface-2)); color:var(--text-primary); }
  `],
})
export class ChatPanelComponent {
  readonly chatUi = inject(ChatUiService);

  readonly title = computed(() => {
    const t = this.chatUi.activeTarget();
    if (!t) return 'Messages';
    if (t.scope === 'dm') return t.to;
    const ch = this.chatUi.projectChannel();
    return ch?.label ?? 'Team chat';
  });

  open(target: ChatTarget): void {
    this.chatUi.setTarget(target);
  }

  back(): void {
    this.chatUi.setTarget(null);
  }

  close(): void {
    this.chatUi.close();
  }
}
