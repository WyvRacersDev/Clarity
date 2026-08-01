import { Injectable } from '@angular/core';

/**
 * Owns the project-detail canvas viewport: the pan offset, zoom level, the
 * empty-canvas panning gesture, grid-overlay visibility, and the screen->canvas
 * coordinate transforms that every drag / marquee / cursor path depends on.
 *
 * Provided per `ProjectDetailComponent` instance (NOT root) so each visit to a
 * project starts with a fresh, unpanned 1:1 viewport — mirroring the old inline
 * field defaults.
 *
 * Change detection: this service holds plain fields only. Template-bound events
 * (toolbar clicks, wheel) schedule change detection on their own; the manually
 * registered document drag listeners in the component still call
 * `cdr.detectChanges()` themselves. Mutating these fields never triggers CD, so
 * the component's existing CD calls remain the single source of refresh — do not
 * add CD here.
 */
@Injectable()
export class CanvasViewportService {
  /** Current zoom factor (1 = 100%). */
  zoom = 1;
  /** Pan offset of the canvas content, in screen pixels. */
  panX = 0;
  panY = 0;

  /** An empty-canvas panning gesture is in progress. */
  isPanning = false;
  /** Pointer origin captured at pan start: client coord minus the current pan. */
  panStartX = 0;
  panStartY = 0;

  /** Grid overlay visibility (toolbar toggle). */
  showGrid = true;

  // ---- Coordinate transforms (screen -> canvas-content space) ----

  /**
   * Convert a screen X into canvas-content X: subtract the container's left
   * edge and the pan offset, then undo the zoom. `offset` peels off a grab
   * offset (e.g. where inside a dragged element the pointer landed) first.
   */
  toCanvasX(clientX: number, rectLeft: number, offset = 0): number {
    return (clientX - rectLeft - offset - this.panX) / this.zoom;
  }
  /** Screen Y -> canvas-content Y. See {@link toCanvasX}. */
  toCanvasY(clientY: number, rectTop: number, offset = 0): number {
    return (clientY - rectTop - offset - this.panY) / this.zoom;
  }

  // ---- Panning gesture ----

  /** Begin an empty-canvas pan from a pointer at (clientX, clientY). */
  beginPan(clientX: number, clientY: number): void {
    this.isPanning = true;
    this.panStartX = clientX - this.panX;
    this.panStartY = clientY - this.panY;
  }
  /** Update the pan offset while the pointer moves during a pan. */
  updatePan(clientX: number, clientY: number): void {
    this.panX = clientX - this.panStartX;
    this.panY = clientY - this.panStartY;
  }
  /** End the pan gesture. */
  endPan(): void {
    this.isPanning = false;
  }

  // ---- Zoom / grid ----

  /** Toolbar zoom-in step (clamped 0.25–3, matching the old inline range). */
  zoomIn(): void {
    this.zoom = Math.min(3, this.zoom + 0.1);
  }
  /** Toolbar zoom-out step. */
  zoomOut(): void {
    this.zoom = Math.max(0.25, this.zoom - 0.1);
  }
  /** Ctrl/⌘ + wheel zoom, clamped to the tighter 0.5–2 gesture range. */
  wheelZoom(deltaY: number): void {
    const delta = deltaY > 0 ? -0.1 : 0.1;
    this.zoom = Math.max(0.5, Math.min(2, this.zoom + delta));
  }
  /** Reset to a 1:1, unpanned viewport. */
  reset(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }
  /** Toggle the grid overlay. */
  toggleGrid(): void {
    this.showGrid = !this.showGrid;
  }

  /**
   * Fit a content bounding box (already in screen px) into the given container,
   * capping zoom at 1:1. Bounds/container come from the component, which knows
   * the elements and DOM; the pan/zoom math lives here.
   */
  fitToBounds(minX: number, minY: number, maxX: number, maxY: number,
              containerWidth: number, containerHeight: number): void {
    const contentWidth = maxX - minX + 100;
    const contentHeight = maxY - minY + 100;
    this.zoom = Math.min(containerWidth / contentWidth, containerHeight / contentHeight, 1);
    this.panX = (containerWidth - contentWidth * this.zoom) / 2 - minX * this.zoom + 50;
    this.panY = (containerHeight - contentHeight * this.zoom) / 2 - minY * this.zoom + 50;
  }
}
