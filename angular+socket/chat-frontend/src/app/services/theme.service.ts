import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type Theme = 'dark' | 'light';

const THEME_KEY = 'clarity-theme';

/**
 * SSR-safe, zoneless theme service. Owns the `data-theme` attribute on
 * document.documentElement and persists the choice to localStorage.
 * The current theme is exposed as a signal so templates react in a zoneless app.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private platformId = inject(PLATFORM_ID);

  /** Reactive current theme; defaults to dark (matches the no-flash boot script). */
  readonly theme = signal<Theme>('dark');

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const stored = this.read();
      const initial: Theme = stored ?? this.attrTheme() ?? 'dark';
      this.apply(initial);
    }
  }

  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this.apply(theme);
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        /* localStorage unavailable — non-fatal */
      }
    }
  }

  isDark(): boolean {
    return this.theme() === 'dark';
  }

  private apply(theme: Theme): void {
    this.theme.set(theme);
    if (isPlatformBrowser(this.platformId)) {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  private read(): Theme | null {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'dark' || t === 'light' ? t : null;
    } catch {
      return null;
    }
  }

  private attrTheme(): Theme | null {
    const t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || t === 'light' ? t : null;
  }
}
