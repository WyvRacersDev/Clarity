import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ChatMessage, ChatService, ChatTarget } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';

/**
 * ChatConversationComponent — the reusable core of chat: history + live stream +
 * composer + edit/delete for ONE conversation (`target`). Embedded by both the
 * slide-in panel and the full Messages page (DRY), so those stay thin shells.
 *
 * Live messages arrive on the shared socket streams; each is filtered to the
 * active target. The sender also appends from the send ack (deduped by id) so a
 * message shows immediately even when this socket isn't in the project room.
 *
 * `meetEnabled` shows a "Start call" affordance that opens Google Meet in a new
 * tab and preps the composer to share the link (Meet has no embeddable/API-less
 * shared-room link, so the initiator pastes the link Meet assigns them).
 */
const URL_RE = /(https?:\/\/[^\s]+)/g;
const TYPING_THROTTLE_MS = 1500;

@Component({
  selector: 'app-chat-conversation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="conv">
      <div class="messages" #scroll>
        @if (loading()) {
          <div class="conv-empty">Loading…</div>
        } @else if (messages().length === 0) {
          <div class="conv-empty">
            <p class="conv-empty-title">No messages yet</p>
            <p class="conv-empty-sub">Say hello 👋</p>
          </div>
        } @else {
          @for (m of messages(); track m.id) {
            <div class="msg" [class.mine]="isMine(m)">
              <div class="msg-avatar" [style.background]="colorFor(m.author)" [title]="m.author">
                {{ initial(m.author) }}
              </div>
              <div class="msg-body">
                <div class="msg-meta">
                  <span class="msg-author">{{ isMine(m) ? 'You' : m.author }}</span>
                  <span class="msg-time">{{ time(m.created_at) }}</span>
                  @if (m.edited_at) { <span class="msg-edited">(edited)</span> }
                </div>
                @if (editingId() === m.id) {
                  <div class="edit-row">
                    <input class="input" [(ngModel)]="editDraft" (keydown.enter)="saveEdit(m)"
                           (keydown.escape)="cancelEdit()" aria-label="Edit message" />
                    <button class="btn btn-primary btn-sm" (click)="saveEdit(m)">Save</button>
                    <button class="btn btn-secondary btn-sm" (click)="cancelEdit()">Cancel</button>
                  </div>
                } @else {
                  <div class="msg-text">
                    @for (part of parts(m.body); track $index) {
                      @if (part.href) {
                        <a [href]="part.href" target="_blank" rel="noopener noreferrer">{{ part.text }}</a>
                      } @else {
                        <span>{{ part.text }}</span>
                      }
                    }
                  </div>
                  @if (isMine(m)) {
                    <div class="msg-actions">
                      <button class="link-btn" (click)="startEdit(m)">Edit</button>
                      <button class="link-btn danger" (click)="remove(m)">Delete</button>
                    </div>
                  }
                }
              </div>
            </div>
          }
        }
      </div>

      @if (typingFrom()) {
        <div class="typing">{{ typingFrom() }} is typing…</div>
      }
      @if (error()) {
        <div class="conv-error">{{ error() }}</div>
      }
      @if (meetHint()) {
        <div class="meet-hint">
          Meet opened in a new tab — paste the link it gives you here and send, so
          everyone joins the same call.
        </div>
      }

      <div class="composer">
        @if (meetEnabled) {
          <button class="icon-btn" (click)="startCall()" title="Start a Google Meet call" aria-label="Start call">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 7l-7 5 7 5V7z"></path>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
          </button>
        }
        <input #composer class="input composer-input" [(ngModel)]="draft"
               (ngModelChange)="onDraftChange()" (keydown.enter)="send()"
               [placeholder]="placeholder" aria-label="Message" />
        <button class="btn btn-primary btn-sm" (click)="send()" [disabled]="!draft().trim()">Send</button>
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; }
    .conv { display:flex; flex-direction:column; height:100%; min-height:0; }
    .messages { flex:1; overflow-y:auto; padding:var(--space-4); display:flex; flex-direction:column; gap:var(--space-3); }
    .conv-empty { margin:auto; text-align:center; color:var(--text-muted); }
    .conv-empty-title { font-weight:600; color:var(--text-secondary); margin:0 0 4px; }
    .conv-empty-sub { margin:0; font-size:var(--text-sm); }
    .msg { display:flex; gap:var(--space-3); align-items:flex-start; }
    .msg.mine { flex-direction:row-reverse; }
    .msg-avatar { flex:0 0 auto; width:32px; height:32px; border-radius:var(--radius-full);
      display:grid; place-items:center; color:#fff; font-size:12px; font-weight:700; }
    .msg-body { max-width:78%; display:flex; flex-direction:column; gap:2px; }
    .msg.mine .msg-body { align-items:flex-end; }
    .msg-meta { display:flex; gap:6px; align-items:baseline; font-size:11px; color:var(--text-muted); }
    .msg-author { font-weight:600; color:var(--text-secondary); }
    .msg-edited { font-style:italic; }
    .msg-text { background:var(--surface-2); color:var(--text-primary); padding:8px 12px;
      border-radius:var(--radius-lg); font-size:var(--text-sm); line-height:1.45; word-break:break-word; white-space:pre-wrap; }
    .msg.mine .msg-text { background:var(--accent-primary); color:var(--accent-fg, #fff); }
    .msg-text a { color:inherit; text-decoration:underline; }
    .msg-actions { display:flex; gap:8px; opacity:0; transition:opacity .12s; }
    .msg:hover .msg-actions { opacity:1; }
    .link-btn { background:none; border:none; padding:0; font-size:11px; color:var(--text-muted); cursor:pointer; }
    .link-btn:hover { color:var(--text-secondary); }
    .link-btn.danger:hover { color:var(--accent-error, #e5484d); }
    .edit-row { display:flex; gap:6px; align-items:center; }
    .typing { padding:2px var(--space-4); font-size:11px; color:var(--text-muted); font-style:italic; }
    .conv-error { padding:6px var(--space-4); font-size:var(--text-sm); color:var(--accent-error, #e5484d); }
    .meet-hint { padding:8px var(--space-4); font-size:12px; color:var(--text-secondary);
      background:var(--surface-2); border-top:1px solid var(--border); }
    .composer { display:flex; gap:8px; align-items:center; padding:var(--space-3) var(--space-4);
      border-top:1px solid var(--border); background:var(--surface-1); }
    .composer-input { flex:1; }
    .input { background:var(--bg-input, var(--surface-2)); border:1px solid var(--border);
      border-radius:var(--radius-md); padding:8px 12px; font-size:var(--text-sm); color:var(--text-primary); }
    .input:focus { outline:none; border-color:var(--border-focus, var(--accent-primary)); }
    .icon-btn { display:grid; place-items:center; width:34px; height:34px; border-radius:var(--radius-md);
      border:1px solid var(--border); background:var(--surface-2); color:var(--text-secondary); cursor:pointer; }
    .icon-btn:hover { color:var(--accent-primary); border-color:var(--accent-primary); }
  `],
})
export class ChatConversationComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) target!: ChatTarget;
  @Input() meetEnabled = false;

  @ViewChild('scroll') private scrollEl?: ElementRef<HTMLElement>;
  @ViewChild('composer') private composerEl?: ElementRef<HTMLInputElement>;

  private chat = inject(ChatService);
  private auth = inject(AuthService);

  readonly messages = signal<ChatMessage[]>([]);
  readonly draft = signal('');
  readonly editDraft = signal('');
  readonly editingId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly typingFrom = signal<string | null>(null);
  readonly meetHint = signal(false);

  private me = '';
  private subs: Subscription[] = [];
  private lastTypingSent = 0;
  private typingTimer: any = null;

  get placeholder(): string {
    return this.target?.scope === 'project' ? 'Message the team…' : 'Write a message…';
  }

  ngOnInit(): void {
    this.me = this.auth.getCurrentUser()?.name ?? '';
    this.subs.push(
      this.chat.onMessage().subscribe((m) => {
        if (this.belongs(m)) {
          this.upsert(m);
          this.markReadSoon();
          this.scrollToBottom();
        }
      }),
      this.chat.onMessageUpdated().subscribe((m) => {
        if (this.belongs(m)) this.upsert(m);
      }),
      this.chat.onMessageDeleted().subscribe((id) => {
        this.messages.update((list) => list.filter((x) => x.id !== id));
      }),
      this.chat.onTyping().subscribe((t) => {
        if (this.typingBelongs(t) && t.from !== this.me) {
          this.typingFrom.set(t.from);
          setTimeout(() => this.typingFrom.set(null), 3000);
        }
      })
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['target'] && this.target) this.reload();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  // --- Data ------------------------------------------------------------------

  private async reload(): Promise<void> {
    this.editingId.set(null);
    this.error.set(null);
    this.meetHint.set(false);
    this.loading.set(true);
    try {
      const history = await this.chat.history(this.target);
      this.messages.set(history);
      this.chat.markRead(this.target);
    } catch (e: any) {
      this.error.set(e?.message || 'Failed to load messages');
    } finally {
      this.loading.set(false);
      this.scrollToBottom();
    }
  }

  async send(): Promise<void> {
    const body = this.draft().trim();
    if (!body) return;
    this.draft.set('');
    this.meetHint.set(false);
    this.error.set(null);
    try {
      const msg = await this.chat.send(this.target, body);
      this.upsert(msg);
      this.scrollToBottom();
    } catch (e: any) {
      this.error.set(e?.message || 'Failed to send');
      this.draft.set(body); // restore so the user doesn't lose their text
    }
  }

  startEdit(m: ChatMessage): void {
    this.editingId.set(m.id);
    this.editDraft.set(m.body);
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  async saveEdit(m: ChatMessage): Promise<void> {
    const body = this.editDraft().trim();
    if (!body) return;
    try {
      const updated = await this.chat.edit(this.target, m.id, body);
      this.upsert(updated);
      this.editingId.set(null);
    } catch (e: any) {
      this.error.set(e?.message || 'Failed to edit');
    }
  }

  async remove(m: ChatMessage): Promise<void> {
    try {
      await this.chat.remove(this.target, m.id);
      this.messages.update((list) => list.filter((x) => x.id !== m.id));
    } catch (e: any) {
      this.error.set(e?.message || 'Failed to delete');
    }
  }

  onDraftChange(): void {
    const now = Date.now();
    if (now - this.lastTypingSent > TYPING_THROTTLE_MS) {
      this.lastTypingSent = now;
      this.chat.typing(this.target);
    }
  }

  /** Open Google Meet in a new tab and prep the composer to share the link. */
  startCall(): void {
    if (typeof window !== 'undefined') {
      window.open('https://meet.google.com/new', '_blank', 'noopener');
    }
    this.meetHint.set(true);
    this.draft.set('📹 Join our call: ');
    setTimeout(() => this.composerEl?.nativeElement.focus(), 0);
  }

  // --- Helpers ---------------------------------------------------------------

  isMine(m: ChatMessage): boolean {
    return m.author === this.me;
  }

  /** Split a body into plain-text and URL parts for safe linkified rendering. */
  parts(body: string): Array<{ text: string; href?: string }> {
    const out: Array<{ text: string; href?: string }> = [];
    let last = 0;
    for (const match of body.matchAll(URL_RE)) {
      const url = match[0];
      const idx = match.index ?? 0;
      if (idx > last) out.push({ text: body.slice(last, idx) });
      out.push({ text: url, href: url });
      last = idx + url.length;
    }
    if (last < body.length) out.push({ text: body.slice(last) });
    return out.length ? out : [{ text: body }];
  }

  initial(name: string): string {
    return (name?.charAt(0) || '?').toUpperCase();
  }

  colorFor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return `hsl(${h} 55% 45%)`;
  }

  time(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  private belongs(m: ChatMessage): boolean {
    if (this.target.scope === 'project') return m.scope === 'project';
    const expected = [this.me, this.target.to].sort().join('|');
    return m.scope === 'dm' && (m.dmKey === expected || m.author === this.target.to);
  }

  private typingBelongs(t: { scope: string; conversationKey: string; from: string }): boolean {
    if (this.target.scope === 'project') return t.scope === 'project';
    const expected = 'dm:' + [this.me, this.target.to].sort().join('|');
    return t.scope === 'dm' && (t.conversationKey === expected || t.from === this.target.to);
  }

  /** Insert or replace a message by id (dedupes ack echo vs. broadcast). */
  private upsert(m: ChatMessage): void {
    this.messages.update((list) => {
      const i = list.findIndex((x) => x.id === m.id);
      if (i >= 0) {
        const next = list.slice();
        next[i] = m;
        return next;
      }
      return [...list, m].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }

  private markReadSoon(): void {
    this.chat.markRead(this.target);
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.scrollEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
