import { Component, OnInit, Input, Output, EventEmitter, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CollabService, TaskComment } from '../../../../services/collab.service';
import { ToDoLst, scheduled_task, RepeatRule } from '../../../../../../../shared_models/models/screen-elements.model';
import { userColor } from '../../../../utils/user-color.util';

/**
 * Fullscreen todo overlay for a single `ToDoLst` element.
 *
 * Extracted out of `project-detail` as a focused smart child. It mutates the
 * bound `list` model directly and emits `(save)` whenever a mutation must be
 * persisted (the parent owns the whole-project save round-trip). Task comments
 * are loaded/posted through `CollabService` and stay live via
 * `task:comment:added` broadcasts.
 */
@Component({
  selector: 'app-fullscreen-todo',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fullscreen-todo.component.html',
  styleUrls: ['./fullscreen-todo.component.css'],
})
export class FullScreenTodoComponent implements OnInit {
  @Input({ required: true }) list!: ToDoLst;

  @Output() closed = new EventEmitter<void>();
  /** Emitted after any model mutation that must be persisted. */
  @Output() save = new EventEmitter<void>();

  // Add-task composer state.
  newTaskName = '';
  newTaskPriority: number | null = null; // Changed to null to require selection
  newTaskTime = '';
  newTaskRepeat: RepeatRule = 'none'; // N7: recurrence rule for the task being composed

  // Tag editing.
  editingTagInput: string = '';

  // A3: task comments panel state.
  /** The task whose comments panel is open, or null. */
  selectedCommentTask: scheduled_task | null = null;
  /** Comments for the selected task, oldest-first. */
  taskComments: TaskComment[] = [];
  newCommentBody = '';
  isLoadingComments = false;
  /** Per-task comment counts, keyed by task id. */
  private commentCounts: Map<string, number> = new Map();

  private collabService = inject(CollabService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    // A3: live task comments — bump counts and append to the open panel.
    this.collabService
      .onCommentAdded()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(c => this.applyRemoteComment(c));
  }

  close(): void {
    this.closed.emit();
  }

  // ---- Tasks ----

  async addTask(): Promise<void> {
    if (!this.list || !this.newTaskName.trim()) return;

    // Convert datetime-local format to ISO string
    let taskTime = new Date().toISOString();
    if (this.newTaskTime) {
      // datetime-local format is YYYY-MM-DDTHH:mm, convert to ISO
      const localDate = new Date(this.newTaskTime);
      if (!isNaN(localDate.getTime())) {
        taskTime = localDate.toISOString();
      }
    }

    // Ensure priority is a number (it should be set by validation, but just in case)
    const priority = typeof this.newTaskPriority === 'string' ?
      parseInt(this.newTaskPriority, 10) : (this.newTaskPriority || 2);

    const task = new scheduled_task(this.newTaskName.trim(), priority, taskTime);
    task.set_repeat(this.newTaskRepeat); // N7
    this.list.add_task(task);

    this.save.emit();
    this.newTaskName = '';
    this.newTaskPriority = null;
    this.newTaskTime = '';
    this.newTaskRepeat = 'none';
  }

  /** N7: cycle a task's repeat rule and persist. Used by the per-task repeat control. */
  updateTaskRepeat(task: scheduled_task, rule: RepeatRule): void {
    if (!this.list) return;
    task.set_repeat(rule);
    this.save.emit();
  }

  onRepeatChange(task: scheduled_task, event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (target) {
      this.updateTaskRepeat(task, target.value as RepeatRule);
    }
  }

  deleteTask(task: scheduled_task): void {
    if (!this.list) return;

    const taskIndex = this.list.scheduled_tasks.findIndex(t => t === task);
    if (taskIndex !== -1) {
      this.list.delete_task(taskIndex);
      this.save.emit();
    }
  }

  toggleTaskStatus(task: scheduled_task): void {
    if (!this.list) return;

    task.toggle_done_status();
    // N7: completing a repeating task spawns its next occurrence in the same list.
    if (task.is_done) {
      const next = task.build_next_occurrence();
      if (next) this.list.add_task(next);
    }
    this.save.emit();
  }

  updateTaskPriority(task: scheduled_task, priority: number): void {
    if (!this.list) return;

    task.edit_priority(priority);
    this.save.emit();
  }

  onPriorityChange(task: scheduled_task, event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (target) {
      this.updateTaskPriority(task, +target.value);
    }
  }

  getUpcomingTasks(): scheduled_task[] {
    return this.list.scheduled_tasks.filter(t => !t.is_done);
  }

  // ---- Tags ----

  getTags(): string[] {
    return this.list.tags ?? [];
  }

  addTag(): void {
    if (!this.list) return;
    const tag = this.editingTagInput.trim();
    if (!tag) return;

    if (!this.list.tags.includes(tag)) {
      this.list.tags.push(tag);
      this.save.emit();
    }

    this.editingTagInput = '';
  }

  removeTag(tag: string): void {
    if (!this.list) return;
    const i = this.list.tags.indexOf(tag);
    if (i !== -1) {
      this.list.tags.splice(i, 1);
      this.save.emit();
    }
  }

  // ---- A3: task comments panel ----

  /** Stable comment key for a task (the DB uuid attached on load, if present). */
  private getTaskId(task: scheduled_task | null): string | null {
    const id = (task as any)?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  /** Comment count badge for a task (0 when unknown). */
  getCommentCount(task: scheduled_task): number {
    const id = this.getTaskId(task);
    if (!id) return 0;
    return this.commentCounts.get(id) ?? 0;
  }

  /** True when the selected task can actually load/post comments. */
  get canComment(): boolean {
    return !!this.getTaskId(this.selectedCommentTask);
  }

  /** Open the comments panel for a task and load its comments. */
  async openTaskComments(task: scheduled_task, event?: MouseEvent): Promise<void> {
    if (event) event.stopPropagation();
    this.selectedCommentTask = task;
    this.taskComments = [];
    this.newCommentBody = '';
    const id = this.getTaskId(task);
    if (!id) {
      // No DB id yet (whole-project load doesn't emit task ids) — panel opens
      // with a hint instead of breaking.
      this.cdr.detectChanges();
      return;
    }
    this.isLoadingComments = true;
    this.cdr.detectChanges();
    try {
      const comments = await this.collabService.listComments(id);
      this.taskComments = comments;
      this.commentCounts.set(id, comments.length);
    } catch (e) {
      console.warn('[FullScreenTodo] listComments failed:', e);
    } finally {
      this.isLoadingComments = false;
      this.cdr.detectChanges();
    }
  }

  closeTaskComments(): void {
    this.selectedCommentTask = null;
    this.taskComments = [];
    this.newCommentBody = '';
    this.cdr.detectChanges();
  }

  /** Post a new comment to the selected task. */
  async submitComment(): Promise<void> {
    const id = this.getTaskId(this.selectedCommentTask);
    const body = this.newCommentBody.trim();
    if (!id || !body) return;
    this.newCommentBody = '';
    try {
      // The broadcast (task:comment:added) delivers the comment to us too, so
      // we let applyRemoteComment append it to avoid duplication.
      await this.collabService.addComment(id, body);
    } catch (e) {
      console.warn('[FullScreenTodo] addComment failed:', e);
      this.newCommentBody = body; // restore on failure
    }
    this.cdr.detectChanges();
  }

  /** Apply a broadcast comment: bump the count and append if its panel is open. */
  private applyRemoteComment(comment: TaskComment): void {
    if (!comment?.taskId) return;
    this.commentCounts.set(comment.taskId, (this.commentCounts.get(comment.taskId) ?? 0) + 1);
    const openId = this.getTaskId(this.selectedCommentTask);
    if (openId && openId === comment.taskId) {
      if (!this.taskComments.some(c => c.id === comment.id)) {
        this.taskComments = [...this.taskComments, comment];
      }
    }
    this.cdr.detectChanges();
  }

  /** Relative "time ago" label for a comment timestamp. */
  formatRelativeTime(iso: string): string {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const diff = Date.now() - then;
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  /** Stable per-author accent color for a comment (template-safe wrapper). */
  authorColor(name: string): string {
    return userColor(name);
  }
}
