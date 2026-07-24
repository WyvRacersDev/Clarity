import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * A single onboarding step: the CSS selector of the element to spotlight,
 * plus the tooltip copy shown alongside it.
 */
export interface TourStep {
  /** CSS selector for the target element (resolved via document.querySelector). */
  selector: string;
  title: string;
  body: string;
}

const TOUR_DONE_KEY = 'clarity_tour_done';

/**
 * SSR-safe, signal-based onboarding tour state.
 *
 * Tracks the active step index and an `active` flag, and persists a
 * "seen" boolean to localStorage (`clarity_tour_done`) so the tour only
 * auto-starts once. All storage access is guarded via isPlatformBrowser.
 * Zoneless-safe: consumers read signals, no Zone.js required.
 */
@Injectable({ providedIn: 'root' })
export class TourService {
  private platformId = inject(PLATFORM_ID);

  /** The four onboarding steps, targeting existing layout-shell elements. */
  readonly steps: TourStep[] = [
    {
      selector: '.sidebar .nav',
      title: 'Navigate everything',
      body: 'Jump between your dashboard, projects, tasks, analytics and AI insights from the sidebar.',
    },
    {
      selector: '.cmdk-trigger',
      title: 'Search & command palette',
      body: 'Press ⌘K anytime to search, navigate, or run quick actions without leaving the keyboard.',
    },
    {
      selector: '.theme-toggle',
      title: 'Light or dark, your call',
      body: 'Toggle between the calm dark theme and a bright light theme whenever you like.',
    },
    {
      selector: '.user-btn',
      title: 'Your account',
      body: 'Open your account menu to review your profile and sign out when you are done.',
    },
  ];

  /** Whether the tour overlay is currently showing. */
  readonly active = signal(false);
  /** Index of the current step. */
  readonly stepIndex = signal(0);

  /** The active step object (or null when the tour is inactive). */
  readonly currentStep = computed<TourStep | null>(() =>
    this.active() ? this.steps[this.stepIndex()] ?? null : null,
  );
  /** Total number of steps (for the progress dots). */
  readonly stepCount = computed(() => this.steps.length);
  /** True on the last step (renders "Done" instead of "Next"). */
  readonly isLast = computed(() => this.stepIndex() >= this.steps.length - 1);

  /** True when the tour has already been completed/skipped (SSR-guarded). */
  hasSeenTour(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return true; // never auto-start on the server
    }
    try {
      return localStorage.getItem(TOUR_DONE_KEY) === 'true';
    } catch {
      return true; // storage unavailable — treat as seen, don't nag
    }
  }

  /** Start the tour from the first step. */
  start(): void {
    this.stepIndex.set(0);
    this.active.set(true);
  }

  /**
   * Start the tour only if it has never been completed. Used for the
   * one-time auto-start on first authed load.
   */
  maybeAutoStart(): void {
    if (!this.hasSeenTour()) {
      this.start();
    }
  }

  /** Advance to the next step, finishing when past the last one. */
  next(): void {
    if (this.isLast()) {
      this.finish();
      return;
    }
    this.stepIndex.update((i) => Math.min(i + 1, this.steps.length - 1));
  }

  /** Go back one step (no-op on the first step). */
  prev(): void {
    this.stepIndex.update((i) => Math.max(i - 1, 0));
  }

  /** Skip the tour entirely and mark it as seen. */
  skip(): void {
    this.finish();
  }

  /** Close the tour and persist the "seen" flag (SSR-guarded). */
  finish(): void {
    this.active.set(false);
    this.markSeen();
  }

  private markSeen(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      localStorage.setItem(TOUR_DONE_KEY, 'true');
    } catch {
      /* non-fatal — storage unavailable */
    }
  }
}
