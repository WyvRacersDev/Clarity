import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { Subscription } from 'rxjs';
import dayjs from 'dayjs';
import { DataService } from '../../services/data.service';
import { User } from '../../../../../shared_models/models/user.model';
import { TaskStatus } from '../../../../../shared_models/models/screen-elements.model';
import {
  TaskLens,
  collectTasks,
} from '../../shared/task-lens.util';
import { priorityLabel } from '../../shared/priority.util';

interface KanbanColumn {
  key: TaskStatus;
  title: string;
  cards: TaskLens[];
}

/**
 * Kanban board (N6) — a status-lane lens over the same tasks the Tasks screen
 * lists. Cards are dragged between To Do / In Progress / Done columns; a drop
 * mutates the task's status via the model (which keeps `is_done` in sync) and
 * persists the owning project through DataService.
 *
 * Data comes from the in-memory user graph (DataService.currentUser$) via the
 * shared task-lens util — no new socket contract. Zoneless: state is held in
 * plain fields (CDK mutates the column arrays directly) and change detection is
 * driven manually, mirroring the project-detail canvas.
 */
@Component({
  selector: 'app-kanban',
  standalone: true,
  imports: [DragDropModule],
  templateUrl: './kanban.component.html',
  styleUrls: ['./kanban.component.css'],
})
export class KanbanComponent implements OnInit, OnDestroy {
  private readonly dataService = inject(DataService);
  private readonly cdr = inject(ChangeDetectorRef);

  private currentUser: User | null = null;
  private sub?: Subscription;

  isLoading = true;
  saving = false;

  activeProject = 'all';
  projectNames: string[] = [];

  readonly columns: KanbanColumn[] = [
    { key: 'todo', title: 'To Do', cards: [] },
    { key: 'in_progress', title: 'In Progress', cards: [] },
    { key: 'done', title: 'Done', cards: [] },
  ];

  /** Drop-list ids so the three columns connect to each other. */
  readonly dropListIds = this.columns.map((c) => `kanban-${c.key}`);

  ngOnInit(): void {
    this.sub = this.dataService.currentUser$.subscribe((user) => {
      this.currentUser = user;
      this.rebuild();
      this.isLoading = false;
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Re-partition the (optionally project-filtered) tasks into the three lanes. */
  private rebuild(): void {
    const byStatus: Record<TaskStatus, TaskLens[]> = {
      todo: [],
      in_progress: [],
      done: [],
    };
    const names = new Set<string>();

    for (const lens of collectTasks(this.currentUser)) {
      names.add(lens.list.projectName);
      if (this.activeProject !== 'all' && lens.list.projectName !== this.activeProject) {
        continue;
      }
      byStatus[lens.task.status].push(lens);
    }

    this.projectNames = Array.from(names).sort((a, b) => a.localeCompare(b));
    if (this.activeProject !== 'all' && !names.has(this.activeProject)) {
      this.activeProject = 'all';
    }
    for (const col of this.columns) {
      col.cards = byStatus[col.key];
    }
  }

  setProject(name: string): void {
    this.activeProject = name;
    this.rebuild();
    this.cdr.detectChanges();
  }

  dropListIdFor(key: TaskStatus): string {
    return `kanban-${key}`;
  }

  async drop(event: CdkDragDrop<TaskLens[]>, target: TaskStatus): Promise<void> {
    if (event.previousContainer === event.container) {
      // Reorder within a lane — purely visual (board order isn't persisted).
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      this.cdr.detectChanges();
      return;
    }

    const card = event.previousContainer.data[event.previousIndex];
    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex
    );

    // Single mutation point keeps status ⟺ is_done consistent (N6).
    card.task.set_status(target, this.currentUser?.name ?? null);
    this.cdr.detectChanges();

    await this.persist(card);
  }

  private async persist(card: TaskLens): Promise<void> {
    this.saving = true;
    this.cdr.detectChanges();
    try {
      await this.dataService.saveProject(card.list.project, card.list.projectType);
    } catch {
      // On failure, re-derive from the source of truth so the board can't drift.
      this.rebuild();
    } finally {
      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  // ─── presentation helpers ──────────────────────────────────────────────────

  priorityLabel(priority: number): string {
    return priorityLabel(priority);
  }

  priorityBadgeClass(priority: number): string {
    if (priority === 1) return 'badge-danger';
    if (priority === 2) return 'badge-info';
    return 'badge-success';
  }

  hasDue(card: TaskLens): boolean {
    return !!card.task.time && dayjs(card.task.time).isValid();
  }

  dueLabel(card: TaskLens): string {
    return dayjs(card.task.time).format('MMM D');
  }

  isOverdue(card: TaskLens): boolean {
    return (
      !card.task.is_done &&
      this.hasDue(card) &&
      dayjs(card.task.time).isBefore(dayjs())
    );
  }

  totalTasks(): number {
    return this.columns.reduce((n, c) => n + c.cards.length, 0);
  }

  trackColumn(_: number, col: KanbanColumn): string {
    return col.key;
  }

  trackCard(_: number, card: TaskLens): any {
    return (card.task as any).id ?? card.task;
  }
}
