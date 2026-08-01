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
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CollabService, ProjectSnapshot } from '../../../services/collab.service';

/**
 * E8 — canvas version history / restore. A self-contained dialog (mirrors
 * ActivityFeed / ShareDialog) opened from the project header. Lists the project's
 * whole-canvas snapshots via the collab gateway (`snapshot:list`), lets an editor
 * save a named checkpoint (`snapshot:create`), and restore the canvas to any
 * version (`snapshot:restore`, full-replace). Live-refreshes when a version is
 * saved by anyone in the room. SSR-safe. On a successful restore it emits
 * `restored` so the parent reloads the canvas from the server.
 */
@Component({
  selector: 'app-version-history',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './version-history.component.html',
  styleUrls: ['./version-history.component.css'],
})
export class VersionHistoryComponent implements OnInit, OnDestroy {
  @Input({ required: true }) projectName!: string;
  @Input() projectType: 'local' | 'hosted' = 'local';
  /** Viewers see history read-only; editors can save + restore. */
  @Input() canEdit = true;
  @Output() closed = new EventEmitter<void>();
  @Output() restored = new EventEmitter<void>();

  private collab = inject(CollabService);
  private platformId = inject(PLATFORM_ID);

  readonly items = signal<ProjectSnapshot[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly restoringId = signal<string | null>(null);
  /** Id of the version awaiting restore confirmation (inline), or null. */
  readonly confirmId = signal<string | null>(null);
  label = '';

  private createdSub?: Subscription;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.refresh();
    // A version saved by anyone in the room shows up without reopening.
    this.createdSub = this.collab.onSnapshotCreated().subscribe((s) => this.upsert(s));
  }

  ngOnDestroy(): void {
    this.createdSub?.unsubscribe();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.collab.listSnapshots());
    } catch {
      this.error.set('Could not load versions');
    } finally {
      this.loading.set(false);
    }
  }

  /** Insert a version at the top (newest-first) unless it's already present. */
  private upsert(s: ProjectSnapshot): void {
    this.items.update((list) => (list.some((x) => x.id === s.id) ? list : [s, ...list]));
  }

  async save(): Promise<void> {
    if (this.saving() || !this.canEdit) return;
    this.saving.set(true);
    this.error.set(null);
    const label = this.label.trim() || undefined;
    try {
      const snap = await this.collab.createSnapshot(label);
      this.upsert(snap);
      this.label = '';
    } catch (e: any) {
      this.error.set(e?.message || 'Could not save version');
    } finally {
      this.saving.set(false);
    }
  }

  askRestore(id: string): void { this.confirmId.set(id); }
  cancelRestore(): void { this.confirmId.set(null); }

  async doRestore(id: string): Promise<void> {
    this.confirmId.set(null);
    this.restoringId.set(id);
    this.error.set(null);
    try {
      await this.collab.restoreSnapshot(id);
      this.restored.emit();
      this.close();
    } catch (e: any) {
      this.error.set(e?.message || 'Could not restore version');
    } finally {
      this.restoringId.set(null);
    }
  }

  close(): void {
    this.closed.emit();
  }

  /** Display title: the manual label, else a kind-derived fallback. */
  labelFor(s: ProjectSnapshot): string {
    if (s.label && s.label.trim().length > 0) return s.label;
    return s.kind === 'manual' ? 'Manual version' : 'Autosave';
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
