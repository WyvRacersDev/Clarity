import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Subscription } from 'rxjs';
import { SocketService } from '../../../services/socket.service';

/** One activity entry from the project feed read-model (N2). */
interface FeedItem {
  kind: 'comment' | 'member_added';
  actor: string;
  detail: string;
  created_at: string;
}

/**
 * N2 — per-project activity feed. A self-contained dialog (mirrors ShareDialog)
 * opened from the project header. Reads the project's activity via the
 * notification gateway's `notification:feed` (a read-model over comments +
 * members, independent of anyone's personal inbox) and live-refreshes when a
 * comment lands in this project. SSR-safe.
 */
@Component({
  selector: 'app-activity-feed',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './activity-feed.component.html',
  styleUrls: ['./activity-feed.component.css'],
})
export class ActivityFeedComponent implements OnInit, OnDestroy {
  @Input({ required: true }) projectName!: string;
  @Input() projectType: 'local' | 'hosted' = 'local';
  @Output() closed = new EventEmitter<void>();

  private socket = inject(SocketService);
  private platformId = inject(PLATFORM_ID);

  readonly items = signal<FeedItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private commentSub?: Subscription;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.refresh();
    // A new comment in this project should show up without reopening.
    this.commentSub = this.socket.onTaskCommentAdded().subscribe(() => this.refresh());
  }

  ngOnDestroy(): void {
    this.commentSub?.unsubscribe();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.socket.notificationFeed(this.projectName, this.projectType, 40).subscribe({
      next: (ack) => {
        if (ack?.success) {
          this.items.set(ack.items ?? []);
        } else {
          this.error.set(ack?.message ?? 'Could not load activity');
        }
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load activity');
        this.loading.set(false);
      },
    });
  }

  close(): void {
    this.closed.emit();
  }

  timeAgo(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (secs < 45) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }
}
