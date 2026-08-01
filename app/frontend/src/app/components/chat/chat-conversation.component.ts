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
import {
  ChatAttachment,
  ChatMessage,
  ChatService,
  ChatTarget,
  ReactionSet,
} from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';
import { AIService } from '../../services/ai.service';

/**
 * ChatConversationComponent — the reusable core of chat: history + live stream +
 * composer + edit/delete for ONE conversation (`target`). Embedded by both the
 * slide-in panel and the full Messages page (DRY), so those stay thin shells.
 *
 * Live messages arrive on the shared socket streams; each is filtered to the
 * active target. The sender also appends from the send ack (deduped by id) so a
 * message shows immediately even when this socket isn't in the project room.
 *
 * Beyond text it supports (E1) emoji reactions, (E2) image/video attachments on
 * project channels, and (E3) @mention autocomplete + highlighting — mentions in
 * a project channel notify the mentioned collaborator via the backend.
 *
 * `meetEnabled` shows a "Start call" affordance (E5): the backend mints ONE
 * shared link — a real Google Meet room when the initiator has a connected
 * Google account, otherwise a shared Jitsi room — and posts it into the
 * conversation, so everyone who clicks "Join call" lands in the same room.
 */
const URL_RE = /(https?:\/\/[^\s]+)/g;
/** A shared call link (Google Meet or Jitsi) — rendered as a "Join call" card. */
const CALL_RE = /(https?:\/\/(?:meet\.google\.com|meet\.jit\.si)\/[^\s]+)/i;
// Mirror the backend's mention grammar (lib/mentions.ts) so highlighting and the
// server's notification parsing agree on what counts as a mention.
const MENTION_RE = /(^|[^\w@])@([a-zA-Z0-9._-]+)/g;
// A trailing, still-being-typed mention at the caret (end of the draft).
const MENTION_TRIGGER_RE = /(?:^|\s)@([a-zA-Z0-9._-]*)$/;
const TYPING_THROTTLE_MS = 1500;
const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];

/** A rendered fragment of a message body: plain text, a link, or a mention. */
interface BodyPart {
  text: string;
  href?: string;
  mention?: string;
}

@Component({
  selector: 'app-chat-conversation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="conv">
      @if (meetEnabled) {
        <div class="call-bar">
          <span class="call-bar-hint">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                 stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
            Video call
          </span>
          <button class="start-call-btn" (click)="startCall()" [disabled]="startingCall()"
                  title="Start a shared call for everyone in this conversation">
            {{ startingCall() ? 'Starting…' : 'Start call' }}
          </button>
        </div>
      }
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
            <div class="msg" [class.mine]="isMine(m)"
                 [class.highlight]="highlightId() === m.id" [attr.data-mid]="m.id">
              <div class="msg-avatar" [style.background]="colorFor(m.author)" [title]="m.author">
                {{ initial(m.author) }}
              </div>
              <div class="msg-body">
                <div class="msg-meta">
                  <span class="msg-author">{{ isMine(m) ? 'You' : m.author }}</span>
                  <span class="msg-time">{{ time(m.created_at) }}</span>
                  @if (m.edited_at) { <span class="msg-edited">(edited)</span> }
                </div>
                @if (parent(m); as p) {
                  <button class="quote" (click)="jumpTo(p.id)" title="View the message this replies to">
                    <span class="quote-author">↩ {{ isMine(p) ? 'You' : p.author }}</span>
                    <span class="quote-body">{{ preview(p) }}</span>
                  </button>
                } @else if (m.replyToId) {
                  <div class="quote quote-missing">
                    <span class="quote-body">↩ Original message unavailable</span>
                  </div>
                }
                @if (editingId() === m.id) {
                  <div class="edit-row">
                    <input class="input" [(ngModel)]="editDraft" (keydown.enter)="saveEdit(m)"
                           (keydown.escape)="cancelEdit()" aria-label="Edit message" />
                    <button class="btn btn-primary btn-sm" (click)="saveEdit(m)">Save</button>
                    <button class="btn btn-secondary btn-sm" (click)="cancelEdit()">Cancel</button>
                  </div>
                } @else {
                  @if (callLink(m.body); as link) {
                    <div class="call-card">
                      <span class="call-card-icon" aria-hidden="true">📹</span>
                      <div class="call-card-main">
                        <span class="call-card-title">
                          {{ isMine(m) ? 'You started a call' : m.author + ' started a call' }}
                        </span>
                        <a class="call-card-join" [href]="link" target="_blank" rel="noopener noreferrer">
                          Join call
                        </a>
                      </div>
                    </div>
                  } @else {
                    @if (m.body) {
                      <div class="msg-text">
                        @for (part of parts(m.body); track $index) {
                          @if (part.href) {
                            <a [href]="part.href" target="_blank" rel="noopener noreferrer">{{ part.text }}</a>
                          } @else if (part.mention) {
                            <span class="mention" [class.mention-me]="part.mention === me">{{ part.text }}</span>
                          } @else {
                            <span>{{ part.text }}</span>
                          }
                        }
                      </div>
                    }
                    @if (m.attachments.length) {
                      <div class="attachments">
                        @for (a of m.attachments; track a.url) {
                          @if (isImage(a)) {
                            <a [href]="a.url" target="_blank" rel="noopener noreferrer">
                              <img class="att-img" [src]="a.url" [alt]="a.name" loading="lazy" />
                            </a>
                          } @else if (isVideo(a)) {
                            <video class="att-video" [src]="a.url" controls preload="metadata"></video>
                          } @else {
                            <a class="att-file" [href]="a.url" target="_blank" rel="noopener noreferrer">
                              <span class="att-icon">📎</span><span class="att-name">{{ a.name }}</span>
                            </a>
                          }
                        }
                      </div>
                    }
                  }

                  <div class="reactions">
                    @for (r of m.reactions; track r.emoji) {
                      <button class="reaction-pill" [class.mine]="mine(r)"
                              (click)="toggleReaction(m, r.emoji)" [title]="r.users.join(', ')">
                        <span class="re-emoji">{{ r.emoji }}</span><span class="re-count">{{ r.users.length }}</span>
                      </button>
                    }
                    <div class="react-add-wrap">
                      <button class="reaction-add" (click)="togglePicker(m)" aria-label="Add reaction">☺</button>
                      @if (reactionPickerFor() === m.id) {
                        <div class="emoji-picker">
                          @for (e of quickEmoji; track e) {
                            <button class="emoji-opt" (click)="pickReaction(m, e)">{{ e }}</button>
                          }
                        </div>
                      }
                    </div>
                  </div>

                  <div class="msg-actions">
                    <button class="link-btn" (click)="startReply(m)">Reply</button>
                    @if (isMine(m)) {
                      <button class="link-btn" (click)="startEdit(m)">Edit</button>
                      <button class="link-btn danger" (click)="remove(m)">Delete</button>
                    }
                  </div>
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
      @if (notice()) {
        <div class="conv-notice">✓ {{ notice() }}</div>
      }

      <div class="composer-wrap">
        @if (replyingTo(); as r) {
          <div class="reply-chip">
            <span class="reply-chip-icon" aria-hidden="true">↩</span>
            <span class="reply-chip-text">
              Replying to <strong>{{ isMine(r) ? 'yourself' : r.author }}</strong>
              <span class="reply-chip-preview">{{ preview(r) }}</span>
            </span>
            <button class="reply-chip-x" (click)="cancelReply()" aria-label="Cancel reply">×</button>
          </div>
        }
        @if (mentionOpen() && mentionCandidates().length) {
          <div class="mention-menu">
            @for (u of mentionCandidates(); track u) {
              <button class="mention-item" (click)="pickMention(u)">
                <span class="mention-dot" [style.background]="colorFor(u)"></span>{{ '@' + u }}
              </button>
            }
          </div>
        }

        @if (pendingAttachments().length || uploading()) {
          <div class="pending">
            @for (a of pendingAttachments(); track a.url) {
              <span class="pending-chip">
                <span class="att-icon">📎</span>{{ a.name }}
                <button class="pending-x" (click)="removePending(a)" aria-label="Remove attachment">×</button>
              </span>
            }
            @if (uploading()) { <span class="pending-hint">Uploading…</span> }
          </div>
        }

        <div class="composer">
          @if (meetEnabled) {
            <button class="call-btn" (click)="startCall()" [disabled]="startingCall()"
                    title="Start a shared call for everyone in this conversation" aria-label="Start call">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 7l-7 5 7 5V7z"></path>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
              </svg>
              <span>Call</span>
            </button>
          }
          @if (canAttach) {
            <button class="icon-btn" (click)="fileInput.click()" title="Attach an image or video" aria-label="Attach">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
              </svg>
            </button>
            <input #fileInput type="file" accept="image/*,video/*" hidden
                   (change)="onFilePicked($event)" />
          }
          @if (canConvert) {
            <button class="icon-btn" (click)="threadToTasks()"
                    [disabled]="converting() || messages().length === 0"
                    [title]="converting() ? 'Creating tasks…' : 'Turn this conversation into tasks'"
                    aria-label="Turn conversation into tasks">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 11l3 3L22 4"></path>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
              </svg>
            </button>
          }
          <input #composer class="input composer-input" [(ngModel)]="draft"
                 (ngModelChange)="onDraftChange()" (keydown.enter)="send()"
                 (keydown.escape)="onComposerEscape()" [placeholder]="placeholder" aria-label="Message" />
          <button class="btn btn-primary btn-sm" (click)="send()" [disabled]="!canSend()">Send</button>
        </div>
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
    .msg-body { max-width:78%; display:flex; flex-direction:column; gap:4px; }
    .msg.mine .msg-body { align-items:flex-end; }
    .msg-meta { display:flex; gap:6px; align-items:baseline; font-size:11px; color:var(--text-muted); }
    .msg-author { font-weight:600; color:var(--text-secondary); }
    .msg-edited { font-style:italic; }
    .msg-text { background:var(--surface-2); color:var(--text-primary); padding:8px 12px;
      border-radius:var(--radius-lg); font-size:var(--text-sm); line-height:1.45; word-break:break-word; white-space:pre-wrap; }
    .msg.mine .msg-text { background:var(--accent-primary); color:var(--accent-fg, #fff); }
    .msg-text a { color:inherit; text-decoration:underline; }
    .quote { display:flex; flex-direction:column; align-items:flex-start; gap:0; max-width:100%;
      padding:3px 10px; border:none; border-left:3px solid var(--accent-primary); background:var(--surface-2);
      border-radius:var(--radius-sm); cursor:pointer; text-align:left; }
    .msg.mine .quote { align-items:flex-end; border-left:none; border-right:3px solid var(--accent-primary); }
    .quote:hover { filter:brightness(0.97); }
    .quote-author { font-size:11px; font-weight:700; color:var(--accent-primary); }
    .quote-body { font-size:12px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis;
      white-space:nowrap; max-width:min(260px, 100%); }
    .quote-missing { border-left-color:var(--border); cursor:default; }
    .msg.mine .quote-missing { border-right-color:var(--border); }
    .quote-missing .quote-body { font-style:italic; }
    .msg.highlight .msg-body { animation:replyFlash 1.6s ease-out; border-radius:var(--radius-lg); }
    @keyframes replyFlash {
      0%, 25% { background:var(--accent-primary-soft, rgba(99,102,241,.18)); }
      100% { background:transparent; }
    }
    .mention { font-weight:600; color:var(--accent-primary); }
    .msg.mine .mention { color:var(--accent-fg, #fff); text-decoration:underline; }
    .mention-me { background:rgba(255,214,10,.22); border-radius:4px; padding:0 3px; }
    .attachments { display:flex; flex-wrap:wrap; gap:6px; }
    .att-img { max-width:220px; max-height:200px; border-radius:var(--radius-md); display:block; }
    .att-video { max-width:260px; max-height:220px; border-radius:var(--radius-md); background:#000; }
    .att-file { display:inline-flex; align-items:center; gap:6px; padding:8px 12px; border-radius:var(--radius-md);
      background:var(--surface-2); border:1px solid var(--border); color:var(--text-secondary);
      font-size:var(--text-sm); text-decoration:none; max-width:220px; }
    .att-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .reactions { display:flex; flex-wrap:wrap; align-items:center; gap:4px; }
    .msg.mine .reactions { flex-direction:row-reverse; }
    .reaction-pill { display:inline-flex; align-items:center; gap:4px; padding:1px 7px; border-radius:var(--radius-full);
      border:1px solid var(--border); background:var(--surface-2); color:var(--text-secondary);
      font-size:12px; line-height:1.6; cursor:pointer; }
    .reaction-pill:hover { border-color:var(--accent-primary); }
    .reaction-pill.mine { background:var(--accent-primary-soft, rgba(99,102,241,.15));
      border-color:var(--accent-primary); color:var(--accent-primary); }
    .re-count { font-weight:600; font-size:11px; }
    .react-add-wrap { position:relative; }
    .reaction-add { width:22px; height:22px; border-radius:var(--radius-full); border:1px solid var(--border);
      background:var(--surface-2); color:var(--text-muted); cursor:pointer; font-size:13px; line-height:1;
      opacity:0; transition:opacity .12s; }
    .msg:hover .reaction-add { opacity:1; }
    .reaction-add:hover { color:var(--accent-primary); border-color:var(--accent-primary); }
    .emoji-picker { position:absolute; bottom:26px; left:0; z-index:20; display:flex; gap:2px; padding:4px;
      background:var(--surface-1); border:1px solid var(--border); border-radius:var(--radius-md);
      box-shadow:var(--shadow-md, 0 6px 20px rgba(0,0,0,.18)); }
    .msg.mine .emoji-picker { left:auto; right:0; }
    .emoji-opt { border:none; background:none; cursor:pointer; font-size:17px; padding:2px 4px; border-radius:6px; }
    .emoji-opt:hover { background:var(--surface-2); }
    .msg-actions { display:flex; gap:8px; opacity:0; transition:opacity .12s; }
    .msg:hover .msg-actions { opacity:1; }
    .link-btn { background:none; border:none; padding:0; font-size:11px; color:var(--text-muted); cursor:pointer; }
    .link-btn:hover { color:var(--text-secondary); }
    .link-btn.danger:hover { color:var(--accent-error, #e5484d); }
    .edit-row { display:flex; gap:6px; align-items:center; }
    .typing { padding:2px var(--space-4); font-size:11px; color:var(--text-muted); font-style:italic; }
    .conv-error { padding:6px var(--space-4); font-size:var(--text-sm); color:var(--accent-error, #e5484d); }
    .conv-notice { padding:6px var(--space-4); font-size:var(--text-sm); color:var(--accent-primary); font-weight:600; }
    .call-card { display:flex; align-items:center; gap:10px; padding:10px 12px;
      border-radius:var(--radius-lg); border:1px solid var(--accent-primary);
      background:var(--surface-2); }
    .call-card-icon { font-size:18px; line-height:1; }
    .call-card-main { display:flex; flex-direction:column; gap:2px; }
    .call-card-title { font-size:var(--text-sm); font-weight:600; color:var(--text-primary); }
    .call-card-join { align-self:flex-start; margin-top:2px; padding:4px 12px; border-radius:var(--radius-md);
      background:var(--accent-primary); color:var(--accent-fg, #fff); font-size:12px; font-weight:600;
      text-decoration:none; }
    .call-card-join:hover { background:var(--accent-primary-hover, var(--accent-primary)); }
    .composer-wrap { position:relative; border-top:1px solid var(--border); background:var(--surface-1); }
    .reply-chip { display:flex; align-items:center; gap:8px; padding:8px var(--space-4) 0; font-size:12px; color:var(--text-muted); }
    .reply-chip-icon { color:var(--accent-primary); font-weight:700; }
    .reply-chip-text { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .reply-chip-text strong { color:var(--text-secondary); }
    .reply-chip-preview { margin-left:6px; opacity:.8; }
    .reply-chip-x { border:none; background:none; cursor:pointer; color:var(--text-muted); font-size:16px; line-height:1; }
    .reply-chip-x:hover { color:var(--accent-error, #e5484d); }
    .mention-menu { position:absolute; bottom:100%; left:var(--space-4); right:var(--space-4); z-index:30;
      max-height:180px; overflow-y:auto; margin-bottom:6px; padding:4px; background:var(--surface-1);
      border:1px solid var(--border); border-radius:var(--radius-md); box-shadow:var(--shadow-md, 0 6px 20px rgba(0,0,0,.18)); }
    .mention-item { display:flex; align-items:center; gap:8px; width:100%; padding:6px 10px; border:none; background:none;
      color:var(--text-primary); font-size:var(--text-sm); text-align:left; cursor:pointer; border-radius:6px; }
    .mention-item:hover { background:var(--surface-2); }
    .mention-dot { width:16px; height:16px; border-radius:var(--radius-full); flex:0 0 auto; }
    .pending { display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:8px var(--space-4) 0; }
    .pending-chip { display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:var(--radius-md);
      background:var(--surface-2); border:1px solid var(--border); font-size:12px; color:var(--text-secondary); }
    .pending-x { border:none; background:none; cursor:pointer; color:var(--text-muted); font-size:14px; line-height:1; }
    .pending-x:hover { color:var(--accent-error, #e5484d); }
    .pending-hint { font-size:12px; color:var(--text-muted); font-style:italic; }
    .composer { display:flex; gap:8px; align-items:center; padding:var(--space-3) var(--space-4); }
    .composer-input { flex:1; }
    .input { background:var(--bg-input, var(--surface-2)); border:1px solid var(--border);
      border-radius:var(--radius-md); padding:8px 12px; font-size:var(--text-sm); color:var(--text-primary); }
    .input:focus { outline:none; border-color:var(--border-focus, var(--accent-primary)); }
    .icon-btn { display:grid; place-items:center; width:34px; height:34px; border-radius:var(--radius-md);
      border:1px solid var(--border); background:var(--surface-2); color:var(--text-secondary); cursor:pointer; }
    .icon-btn:hover { color:var(--accent-primary); border-color:var(--accent-primary); }
    .call-bar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between;
      gap:var(--space-3); padding:8px var(--space-4); border-bottom:1px solid var(--border);
      background:var(--surface-1); }
    .call-bar-hint { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--text-muted); }
    .start-call-btn { display:inline-flex; align-items:center; gap:6px; padding:6px 12px;
      border-radius:var(--radius-md); border:none; cursor:pointer; font-size:var(--text-sm); font-weight:600;
      background:var(--accent-primary); color:var(--accent-fg, #fff); }
    .start-call-btn:hover { background:var(--accent-primary-hover, var(--accent-primary)); }
    .start-call-btn:disabled, .call-btn:disabled { opacity:.6; cursor:default; }
    .call-btn { display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 12px;
      border-radius:var(--radius-md); border:1px solid var(--accent-primary); background:var(--surface-2);
      color:var(--accent-primary); cursor:pointer; font-size:var(--text-sm); font-weight:600; white-space:nowrap; }
    .call-btn:hover { background:var(--accent-primary); color:var(--accent-fg, #fff); }
  `],
})
export class ChatConversationComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) target!: ChatTarget;
  @Input() meetEnabled = false;

  @ViewChild('scroll') private scrollEl?: ElementRef<HTMLElement>;
  @ViewChild('composer') private composerEl?: ElementRef<HTMLInputElement>;

  private chat = inject(ChatService);
  private auth = inject(AuthService);
  private ai = inject(AIService);

  readonly messages = signal<ChatMessage[]>([]);
  readonly draft = signal('');
  readonly editDraft = signal('');
  readonly editingId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly typingFrom = signal<string | null>(null);

  // E5 — shared call minting in flight.
  readonly startingCall = signal(false);

  // E9 (slice 2) — "turn thread into tasks" in flight + a transient success note.
  readonly converting = signal(false);
  readonly notice = signal<string | null>(null);

  // E4 — the message the composer is replying to (inline quoted reply), and the
  // message briefly flashed after jumping to a quoted parent.
  readonly replyingTo = signal<ChatMessage | null>(null);
  readonly highlightId = signal<string | null>(null);

  // E1 — which message's quick-reaction picker is open.
  readonly reactionPickerFor = signal<string | null>(null);
  readonly quickEmoji = QUICK_EMOJI;

  // E2 — attachments staged for the next send.
  readonly pendingAttachments = signal<ChatAttachment[]>([]);
  readonly uploading = signal(false);

  // E3 — @mention autocomplete state.
  readonly mentionOpen = signal(false);
  private readonly mentionQuery = signal('');

  me = '';
  private subs: Subscription[] = [];
  private lastTypingSent = 0;

  get placeholder(): string {
    return this.target?.scope === 'project' ? 'Message the team…' : 'Write a message…';
  }

  /** Attachments upload through the project asset path, so DMs can't attach yet. */
  get canAttach(): boolean {
    return this.target?.scope === 'project';
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
      this.chat.onMessageReacted().subscribe(({ id, reactions }) => {
        this.applyReactions(id, reactions);
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
    this.reactionPickerFor.set(null);
    this.replyingTo.set(null);
    this.pendingAttachments.set([]);
    this.closeMention();
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

  /** Can we send? Either some text or at least one uploaded attachment. */
  canSend(): boolean {
    return (!!this.draft().trim() || this.pendingAttachments().length > 0) && !this.uploading();
  }

  async send(): Promise<void> {
    const body = this.draft().trim();
    const attachments = this.pendingAttachments();
    if (!body && attachments.length === 0) return;
    if (this.uploading()) return;
    const replyTo = this.replyingTo();
    this.draft.set('');
    this.pendingAttachments.set([]);
    this.replyingTo.set(null);
    this.closeMention();
    this.error.set(null);
    try {
      const msg = await this.chat.send(this.target, body, {
        attachments,
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      });
      this.upsert(msg);
      this.scrollToBottom();
    } catch (e: any) {
      this.error.set(e?.message || 'Failed to send');
      this.draft.set(body); // restore so the user doesn't lose their text
      this.pendingAttachments.set(attachments);
      this.replyingTo.set(replyTo); // restore the reply target too
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
    this.updateMentionState();
  }

  // --- Calls (E5) ------------------------------------------------------------

  /**
   * Start a call: ask the backend to mint one shared link, post it to the
   * conversation (a "Join call" card appears for everyone), then open it here.
   */
  async startCall(): Promise<void> {
    if (this.startingCall()) return;
    this.startingCall.set(true);
    this.error.set(null);
    try {
      const { link } = await this.chat.startCall(this.target);
      if (typeof window !== 'undefined') window.open(link, '_blank', 'noopener');
    } catch (e: any) {
      this.error.set(e?.message || 'Failed to start call');
    } finally {
      this.startingCall.set(false);
    }
  }

  /** The shared call URL in a message body (Meet or Jitsi), or null if none. */
  callLink(body: string): string | null {
    const m = body.match(CALL_RE);
    return m ? m[0] : null;
  }

  // --- Thread → tasks (E9 slice 2) -------------------------------------------

  /** Only offered on project channels (tasks belong to a project). */
  get canConvert(): boolean {
    return this.target?.scope === 'project';
  }

  /**
   * Turn the loaded conversation into tasks: serialize the recent messages and
   * ask the AI to extract action items and create them in this channel's
   * project. Skips call cards / empty bodies; caps length to bound the request.
   */
  async threadToTasks(): Promise<void> {
    if (this.converting() || this.target.scope !== 'project') return;
    const lines = this.messages()
      .filter((m) => m.body && !this.callLink(m.body))
      .slice(-100)
      .map((m) => `${m.author}: ${m.body.trim()}`);
    if (lines.length === 0) {
      this.error.set('There are no messages to turn into tasks yet.');
      return;
    }
    this.converting.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const res = await this.ai.threadToTasks(
        this.target.projectName,
        this.target.projectType,
        lines.join('\n')
      );
      this.notice.set(res.message);
      // Auto-clear the success note after a few seconds.
      setTimeout(() => this.notice.set(null), 6000);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || 'Failed to create tasks');
    } finally {
      this.converting.set(false);
    }
  }

  // --- Threaded replies (E4) -------------------------------------------------

  /** Start composing a reply to `m`; the composer shows a "Replying to…" chip. */
  startReply(m: ChatMessage): void {
    this.replyingTo.set(m);
    setTimeout(() => this.composerEl?.nativeElement.focus(), 0);
  }

  cancelReply(): void {
    this.replyingTo.set(null);
  }

  /** Escape clears the mention menu first, then any active reply. */
  onComposerEscape(): void {
    if (this.mentionOpen()) {
      this.closeMention();
      return;
    }
    this.cancelReply();
  }

  /** The parent a reply points at, if it's still loaded (else null). */
  parent(m: ChatMessage): ChatMessage | null {
    if (!m.replyToId) return null;
    return this.messages().find((x) => x.id === m.replyToId) ?? null;
  }

  /** A short one-line preview of a message for the quoted reply header/chip. */
  preview(m: ChatMessage): string {
    const body = (m.body || '').replace(/\s+/g, ' ').trim();
    if (body) return body.length > 90 ? body.slice(0, 90) + '…' : body;
    if (m.attachments.length) return '📎 Attachment';
    return 'Message';
  }

  /** Scroll a quoted parent into view and flash it briefly. */
  jumpTo(id: string): void {
    const host = this.scrollEl?.nativeElement;
    const el = host?.querySelector(`[data-mid="${id}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.highlightId.set(id);
    setTimeout(() => this.highlightId.set(null), 1600);
  }

  // --- Reactions (E1) --------------------------------------------------------

  togglePicker(m: ChatMessage): void {
    this.reactionPickerFor.update((cur) => (cur === m.id ? null : m.id));
  }

  pickReaction(m: ChatMessage, emoji: string): void {
    this.reactionPickerFor.set(null);
    this.toggleReaction(m, emoji);
  }

  async toggleReaction(m: ChatMessage, emoji: string): Promise<void> {
    try {
      const reactions = await this.chat.react(this.target, m.id, emoji);
      this.applyReactions(m.id, reactions);
    } catch (e: any) {
      this.error.set(e?.message || 'Failed to react');
    }
  }

  /** True when the current user is among a reaction's users. */
  mine(r: ReactionSet): boolean {
    return r.users.includes(this.me);
  }

  private applyReactions(id: string, reactions: ReactionSet[]): void {
    this.messages.update((list) => {
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return list;
      const next = list.slice();
      next[i] = { ...next[i], reactions };
      return next;
    });
  }

  // --- Attachments (E2) ------------------------------------------------------

  async onFilePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file || this.target.scope !== 'project') return;
    this.error.set(null);
    this.uploading.set(true);
    try {
      const attachment = await this.chat.uploadAttachment(
        this.target.projectName,
        this.target.projectType,
        file
      );
      this.pendingAttachments.update((list) => [...list, attachment]);
      setTimeout(() => this.composerEl?.nativeElement.focus(), 0);
    } catch (e: any) {
      this.error.set(e?.message || 'Failed to upload file');
    } finally {
      this.uploading.set(false);
    }
  }

  removePending(a: ChatAttachment): void {
    this.pendingAttachments.update((list) => list.filter((x) => x.url !== a.url));
  }

  isImage(a: ChatAttachment): boolean {
    return a.mime.startsWith('image/');
  }

  isVideo(a: ChatAttachment): boolean {
    return a.mime.startsWith('video/');
  }

  // --- Mentions (E3) ---------------------------------------------------------

  /** Detect a trailing `@query` at the caret and open/close the mention menu. */
  private updateMentionState(): void {
    const match = this.draft().match(MENTION_TRIGGER_RE);
    if (match) {
      this.mentionQuery.set((match[1] ?? '').toLowerCase());
      this.mentionOpen.set(true);
    } else {
      this.closeMention();
    }
  }

  /**
   * Mention candidates: everyone who has posted in this conversation (plus the
   * DM partner), minus me, filtered by the trailing query. Derived from loaded
   * history so it needs no extra round-trip.
   */
  mentionCandidates(): string[] {
    const q = this.mentionQuery();
    const names = new Set<string>();
    for (const m of this.messages()) {
      if (m.author && m.author !== this.me) names.add(m.author);
    }
    if (this.target.scope === 'dm' && this.target.to) names.add(this.target.to);
    return Array.from(names)
      .filter((n) => n.toLowerCase().startsWith(q))
      .slice(0, 6);
  }

  pickMention(username: string): void {
    const next = this.draft().replace(MENTION_TRIGGER_RE, (whole) => {
      // Preserve the leading whitespace the trigger may have matched.
      const lead = whole.startsWith('@') ? '' : whole.charAt(0);
      return `${lead}@${username} `;
    });
    this.draft.set(next);
    this.closeMention();
    setTimeout(() => this.composerEl?.nativeElement.focus(), 0);
  }

  closeMention(): void {
    this.mentionOpen.set(false);
    this.mentionQuery.set('');
  }

  // --- Helpers ---------------------------------------------------------------

  isMine(m: ChatMessage): boolean {
    return m.author === this.me;
  }

  /** Split a body into text / link / mention parts for safe rendering. */
  parts(body: string): BodyPart[] {
    const out: BodyPart[] = [];
    let last = 0;
    for (const match of body.matchAll(URL_RE)) {
      const url = match[0];
      const idx = match.index ?? 0;
      if (idx > last) out.push(...this.splitMentions(body.slice(last, idx)));
      out.push({ text: url, href: url });
      last = idx + url.length;
    }
    if (last < body.length) out.push(...this.splitMentions(body.slice(last)));
    return out.length ? out : [{ text: body }];
  }

  /** Break a plain-text run into text + mention parts. */
  private splitMentions(text: string): BodyPart[] {
    const out: BodyPart[] = [];
    let last = 0;
    for (const match of text.matchAll(MENTION_RE)) {
      const lead = match[1] ?? '';
      const name = match[2] ?? '';
      const idx = match.index ?? 0;
      const mentionStart = idx + lead.length;
      if (mentionStart > last) out.push({ text: text.slice(last, mentionStart) });
      out.push({ text: `@${name}`, mention: name });
      last = mentionStart + 1 + name.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out.length ? out : [{ text }];
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
        // Preserve any reactions already applied locally if the incoming copy
        // (e.g. a send ack) carries none yet.
        next[i] = { ...m, reactions: m.reactions?.length ? m.reactions : next[i].reactions };
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
