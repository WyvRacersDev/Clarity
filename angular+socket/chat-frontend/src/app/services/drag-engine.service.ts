import { Injectable } from '@angular/core';
import { Screen_Element } from '../../../../shared_models/models/screen-elements.model';

/**
 * Owns the project-detail canvas *gesture session* state: the long-press that
 * arms an element drag, the active drag session (which element/grid, the grab
 * offset, and the group-move start snapshot), and the active resize session
 * (which element/handle, the pointer + size at grab time).
 *
 * Provided per `ProjectDetailComponent` instance (NOT root) so each visit starts
 * with a clean, idle engine.
 *
 * Scope boundary: this service holds session state and the self-contained
 * geometry (resize clamping) + timer lifecycle (long-press cancel). It does NOT
 * touch the project model, collaboration emits, snapping, saving, or change
 * detection — those stay in the component, which reads this state and calls
 * these helpers. Mutating these fields never schedules CD.
 */
@Injectable()
export class DragEngineService {
  // ---- element drag session ----
  /** The DOM card currently being dragged (null when idle). */
  draggedElement: HTMLElement | null = null;
  /** Index of the dragged element within its grid's Screen_elements. */
  draggedElementIndex = -1;
  /** Grid index of the dragged element. */
  draggedElementGridIndex = -1;
  /** Pointer grab offset inside the card (screen px), peeled off during the move transform. */
  elementDragOffsetX = 0;
  elementDragOffsetY = 0;
  /** A drag is armed/active (long-press fired). */
  isDraggingEnabled = false;
  /** G2: start positions of every selected element, for applying a shared group-move delta. */
  groupDragStart: Map<number, { x: number; y: number }> | null = null;

  // ---- long-press arming ----
  /** Pending long-press timer handle (null when not arming). */
  longPressTimer: any = null;
  /** Index showing the "press-and-hold" affordance while the timer runs (-1 = none). */
  longPressTargetIndex = -1;

  // ---- resize session ----
  isResizing = false;
  resizeHandle = '';
  resizingElement: Screen_Element | null = null;
  resizingElementIndex = -1;
  resizingElementGridIndex = -1;
  /** Pointer position captured at resize start (screen px). */
  startResizeX = 0;
  startResizeY = 0;
  /** Element size captured at resize start (px). */
  startWidth = 0;
  startHeight = 0;

  /** Minimum element size while resizing (px). */
  private static readonly MIN_WIDTH = 100;
  private static readonly MIN_HEIGHT = 50;

  /**
   * Cancel a pending long-press (clears the timer and the hold affordance).
   * Safe to call when no timer is armed.
   */
  cancelLongPress(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressTargetIndex = -1;
  }

  /** Begin a resize session, snapshotting the pointer origin and starting size. */
  beginResize(element: Screen_Element, elementIndex: number, gridIndex: number,
              handle: string, clientX: number, clientY: number,
              startWidth: number, startHeight: number): void {
    this.isResizing = true;
    this.resizeHandle = handle;
    this.resizingElement = element;
    this.resizingElementIndex = elementIndex;
    this.resizingElementGridIndex = gridIndex;
    this.startResizeX = clientX;
    this.startResizeY = clientY;
    this.startWidth = startWidth;
    this.startHeight = startHeight;
  }

  /**
   * Given the current pointer, compute the new element size for the active
   * resize session: start size + pointer delta, clamped to the minimums.
   *
   * NOTE: currently dormant — `startResize` still arms a resize session, but the
   * element-resize move handler was never wired (see the note in
   * ProjectDetailComponent where onCanvasMouseMove/Up were removed). Kept as the
   * resize geometry for whenever a live move handler is added.
   */
  computeResizeSize(clientX: number, clientY: number): { width: number; height: number } {
    const width = Math.max(DragEngineService.MIN_WIDTH, this.startWidth + (clientX - this.startResizeX));
    const height = Math.max(DragEngineService.MIN_HEIGHT, this.startHeight + (clientY - this.startResizeY));
    return { width, height };
  }
}
