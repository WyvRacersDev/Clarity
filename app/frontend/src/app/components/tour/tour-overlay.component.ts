import {
  Component,
  HostListener,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TourService } from '../../services/tour.service';

/** A measured rectangle for the spotlight cutout (viewport coordinates). */
interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Aurora onboarding spotlight overlay.
 *
 * Renders a dimmed scrim with a highlighted cutout around the current tour
 * step's target element, plus a small glass tooltip (title, body, controls,
 * step dots). Target elements are located via document.querySelector, guarded
 * by isPlatformBrowser. Zoneless-safe (signals + effect); reacts to the
 * TourService signals. Keyboard Esc = skip.
 */
@Component({
  selector: 'app-tour-overlay',
  standalone: true,
  imports: [],
  templateUrl: './tour-overlay.component.html',
  styleUrls: ['./tour-overlay.component.css'],
})
export class TourOverlayComponent {
  readonly tour = inject(TourService);
  private platformId = inject(PLATFORM_ID);

  /** Padding around the target element for the cutout, in px. */
  private readonly pad = 8;

  /** Measured rect of the current target (null while measuring / no target). */
  readonly targetRect = signal<Rect | null>(null);

  constructor() {
    // Re-measure whenever the active step (or active flag) changes.
    effect(() => {
      const step = this.tour.currentStep();
      if (step && isPlatformBrowser(this.platformId)) {
        // Defer to allow layout to settle (e.g. after nav render).
        queueMicrotask(() => this.measure());
      } else {
        this.targetRect.set(null);
      }
    });
  }

  /** Spotlight cutout geometry, padded and clamped to the viewport. */
  readonly spotlight = computed<Rect | null>(() => {
    const r = this.targetRect();
    if (!r) return null;
    return {
      top: r.top - this.pad,
      left: r.left - this.pad,
      width: r.width + this.pad * 2,
      height: r.height + this.pad * 2,
    };
  });

  /**
   * Position for the tooltip: below the spotlight when there is room,
   * otherwise above it. Falls back to centered when no target is measured.
   */
  readonly tooltipStyle = computed<Record<string, string>>(() => {
    const s = this.spotlight();
    if (!s || !isPlatformBrowser(this.platformId)) {
      const centered: Record<string, string> = {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
      return centered;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tipW = Math.min(320, vw - 32);
    const gap = 14;

    // Horizontal: align tooltip's left with the spotlight, clamped to viewport.
    let left = s.left;
    left = Math.max(16, Math.min(left, vw - tipW - 16));

    // Vertical: prefer below, flip above if the bottom half is too tight.
    const below = s.top + s.height + gap;
    const placeAbove = below + 180 > vh && s.top - gap > 200;

    if (placeAbove) {
      const above: Record<string, string> = {
        left: `${left}px`,
        bottom: `${vh - s.top + gap}px`,
        width: `${tipW}px`,
      };
      return above;
    }
    const beneath: Record<string, string> = {
      left: `${left}px`,
      top: `${below}px`,
      width: `${tipW}px`,
    };
    return beneath;
  });

  /** Array of step indices for rendering the progress dots. */
  readonly dots = computed(() =>
    Array.from({ length: this.tour.stepCount() }, (_, i) => i),
  );

  private measure(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const step = this.tour.currentStep();
    if (!step) {
      this.targetRect.set(null);
      return;
    }
    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) {
      // Target not on this page — center the tooltip with no cutout.
      this.targetRect.set(null);
      return;
    }
    const r = el.getBoundingClientRect();
    this.targetRect.set({
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    });
  }

  next(): void {
    this.tour.next();
  }

  prev(): void {
    this.tour.prev();
  }

  skip(): void {
    this.tour.skip();
  }

  // Re-measure on viewport changes so the cutout tracks the target.
  @HostListener('window:resize')
  @HostListener('window:scroll')
  onViewportChange(): void {
    if (this.tour.active()) {
      this.measure();
    }
  }

  // Esc = skip the tour.
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.tour.active()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.skip();
    }
  }
}
