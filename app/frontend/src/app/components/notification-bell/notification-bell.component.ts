import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { SocketService } from '../../services/socket.service';

/** One inbox entry as served by the notification gateway (N2). */
interface Notification {
  id: string;
  type: 'mention' | 'comment' | 'project_shared' | 'ai_suggestion' | 'due_soon';
  actor: string | null;
  projectName: string | null;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

/**
 * N2 — topbar notification bell. Shows an unread badge and, on click, a dropdown
 * inbox backed by the notification gateway (list / markRead / markAllRead) and
 * live-updated by `notification:new`. Self-contained (own open/close + outside-
 * click dismissal, mirroring the command palette). SSR-safe: all socket work is
 * guarded behind isPlatformBrowser.
 */
@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification-bell.component.html',
  styleUrls: ['./notification-bell.component.css'],
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  private socket = inject(SocketService);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  private host = inject(ElementRef<HTMLElement>);

  readonly isOpen = signal(false);
  readonly items = signal<Notification[]>([]);
  readonly unread = signal(0);
  readonly loading = signal(false);

  private newSub?: Subscription;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Seed the badge without opening the panel.
    this.socket.notificationUnreadCount().subscribe({
      next: (ack) => { if (ack?.success) this.unread.set(ack.count); },
      error: () => {},
    });

    // Live pushes: prepend + bump the badge. If the panel is open we already
    // show the newest first, so it appears without a refetch.
    this.newSub = this.socket.onNotificationNew().subscribe((n: Notification) => {
      this.items.update((list) => [n, ...list].slice(0, 50));
      this.unread.update((c) => c + 1);
    });
  }

  ngOnDestroy(): void {
    this.newSub?.unsubscribe();
  }

  toggle(event?: Event): void {
    event?.stopPropagation();
    const next = !this.isOpen();
    this.isOpen.set(next);
    if (next) this.load();
  }

  close(): void {
    this.isOpen.set(false);
  }

  /** Dismiss the panel on any click outside this component's subtree. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.isOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) this.close();
  }

  private load(): void {
    this.loading.set(true);
    this.socket.notificationList(30).subscribe({
      next: (ack) => {
        if (ack?.success) {
          this.items.set(ack.notifications ?? []);
          this.unread.set(ack.unreadCount ?? 0);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onItemClick(n: Notification): void {
    if (!n.read) {
      this.items.update((list) =>
        list.map((x) => (x.id === n.id ? { ...x, read: true } : x))
      );
      this.socket.notificationMarkRead(n.id).subscribe({
        next: (ack) => { if (ack?.success) this.unread.set(ack.unreadCount ?? 0); },
        error: () => {},
      });
    }
    if (n.link) {
      this.close();
      this.router.navigateByUrl(n.link);
    }
  }

  markAllRead(event?: Event): void {
    event?.stopPropagation();
    this.items.update((list) => list.map((x) => ({ ...x, read: true })));
    this.unread.set(0);
    this.socket.notificationMarkAllRead().subscribe({ next: () => {}, error: () => {} });
  }

  /** Icon key for the @switch in the template. */
  iconFor(type: Notification['type']): string {
    return type;
  }

  /** Compact relative time ("just now", "5m", "3h", "2d"). */
  timeAgo(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (secs < 45) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Date(iso).toLocaleDateString();
  }
}
