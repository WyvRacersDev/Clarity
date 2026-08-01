import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SocketService } from '../../../services/socket.service';

/** A collaborator row as sent by the sharing gateway. */
interface Member {
  userId: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  role: 'viewer' | 'editor' | 'admin';
}

/** A pending email invitation. */
interface Invitation {
  id: string;
  email: string;
  role: 'viewer' | 'editor' | 'admin';
  createdAt: string;
}

type LinkRole = 'none' | 'viewer' | 'editor';

/**
 * N1 — Share dialog. Self-contained (SRP): owns all sharing socket round-trips
 * for one project, so the (very large) project-detail component only has to
 * toggle it open. Managers (owner/admin) can invite by email, change roles,
 * revoke access, and toggle "anyone with the link" sharing; non-managers get a
 * read-only view of who has access.
 */
@Component({
  selector: 'app-share-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './share-dialog.component.html',
  styleUrls: ['./share-dialog.component.css'],
})
export class ShareDialogComponent implements OnInit, OnDestroy {
  /** Project this dialog manages sharing for. */
  @Input({ required: true }) projectName!: string;
  @Input({ required: true }) projectType!: 'local' | 'hosted';
  /** Whether the current user may CHANGE sharing (owner/admin). */
  @Input() canManage = false;
  /** Project owner's display name (shown as the pinned owner row). */
  @Input() ownerName = '';
  /** Current user's name — used to label "you" and avoid self-removal footguns. */
  @Input() currentUsername = '';

  @Output() closed = new EventEmitter<void>();

  members: Member[] = [];
  invitations: Invitation[] = [];
  link: { role: LinkRole; token: string | null } = { role: 'none', token: null };

  inviteEmail = '';
  inviteRole: 'viewer' | 'editor' | 'admin' = 'editor';

  loading = true;
  busy = false;
  error = '';
  copied = false;

  readonly roles: Array<'viewer' | 'editor' | 'admin'> = ['viewer', 'editor', 'admin'];

  private sub?: Subscription;

  constructor(private socket: SocketService) {}

  ngOnInit(): void {
    this.refresh();
    // Live-refresh when anyone changes sharing for this project.
    this.sub = this.socket.onSharingUpdated().subscribe((data: any) => {
      if (data?.projectName === this.projectName && data?.projectType === this.projectType) {
        this.applyState(data);
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Pull the current sharing state from the server. */
  private refresh(): void {
    this.loading = true;
    this.socket.sharingGet(this.projectName, this.projectType).subscribe({
      next: (res: any) => {
        this.loading = false;
        if (res?.success) this.applyState(res);
        else this.error = res?.message || 'Failed to load sharing settings';
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.message || 'Failed to load sharing settings';
      },
    });
  }

  private applyState(state: any): void {
    this.members = state.members ?? [];
    this.invitations = state.invitations ?? [];
    this.link = state.link ?? { role: 'none', token: null };
  }

  // ─── Mutations (manager-only) ──────────────────────────────────────────────

  invite(): void {
    const email = this.inviteEmail.trim();
    if (!email || !this.canManage) return;
    this.run(this.socket.sharingInvite(this.projectName, this.projectType, email, this.inviteRole), (res) => {
      this.inviteEmail = '';
      this.applyState(res);
    });
  }

  changeRole(m: Member, role: string): void {
    if (!this.canManage || role === m.role) return;
    this.run(this.socket.sharingUpdateRole(this.projectName, this.projectType, m.userId, role));
  }

  removeMember(m: Member): void {
    if (!this.canManage) return;
    this.run(this.socket.sharingRemoveMember(this.projectName, this.projectType, m.userId));
  }

  revokeInvite(inv: Invitation): void {
    if (!this.canManage) return;
    this.run(this.socket.sharingRevokeInvite(this.projectName, this.projectType, inv.email));
  }

  setLinkRole(role: string): void {
    if (!this.canManage) return;
    this.run(this.socket.sharingSetLink(this.projectName, this.projectType, role), (res) => {
      if (res?.link) this.link = res.link;
    });
  }

  /** Run a sharing observable, applying the fresh state from its ack. */
  private run(obs: any, then?: (res: any) => void): void {
    this.busy = true;
    this.error = '';
    obs.subscribe({
      next: (res: any) => {
        this.busy = false;
        if (res?.success) {
          this.applyState(res);
          then?.(res);
        } else {
          this.error = res?.message || 'Action failed';
        }
      },
      error: (err: any) => {
        this.busy = false;
        this.error = err?.message || 'Action failed';
      },
    });
  }

  // ─── Link helpers ──────────────────────────────────────────────────────────

  get linkEnabled(): boolean {
    return this.link.role !== 'none';
  }

  /** The shareable URL = this project's page, tagged with the share token. */
  get shareUrl(): string {
    if (typeof window === 'undefined' || !this.linkEnabled) return '';
    const base = `${window.location.origin}${window.location.pathname}`;
    return this.link.token ? `${base}?token=${this.link.token}` : base;
  }

  copyLink(): void {
    const url = this.shareUrl;
    if (!url || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(url).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 1800);
    });
  }

  initials(name: string): string {
    return (name || '?').trim().slice(0, 2).toUpperCase();
  }

  close(): void {
    this.closed.emit();
  }
}
