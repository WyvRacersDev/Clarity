import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type Theme = 'dark' | 'light';
/** Colour world. `regular` (earthy olive/lime) is the default; `clarity` is
 *  the original album-iris cyan world. Orthogonal to {@link Theme}. */
export type Palette = 'regular' | 'clarity';

const THEME_KEY = 'clarity-theme';
const PALETTE_KEY = 'clarity-palette';

/**
 * SSR-safe, zoneless theme service. Owns two orthogonal axes on
 * document.documentElement:
 *   - `data-theme`   → light | dark   (the topbar toggle)
 *   - `data-palette` → regular | clarity (chosen in Settings)
 * Both persist to localStorage and are exposed as signals so templates react
 * in a zoneless app. Defaults: dark + regular (match the no-flash boot script).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private platformId = inject(PLATFORM_ID);

  /** Reactive light/dark; defaults to dark. */
  readonly theme = signal<Theme>('dark');
  /** Reactive colour world; defaults to regular. */
  readonly palette = signal<Palette>('regular');

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const theme: Theme = this.readTheme() ?? this.attrTheme() ?? 'dark';
      const palette: Palette = this.readPalette() ?? this.attrPalette() ?? 'regular';
      this.applyTheme(theme);
      this.applyPalette(palette);
    }
  }

  // ── Light / dark ──────────────────────────────────────────────────────────
  toggle(): void {
    this.setTheme(this.theme() === 'dark' ? 'light' : 'dark');
  }

  setTheme(theme: Theme): void {
    this.applyTheme(theme);
    this.persist(THEME_KEY, theme);
  }

  /** Back-compat alias — older callers used `set(theme)`. */
  set(theme: Theme): void {
    this.setTheme(theme);
  }

  isDark(): boolean {
    return this.theme() === 'dark';
  }

  // ── Palette (colour world) ─────────────────────────────────────────────────
  setPalette(palette: Palette): void {
    this.applyPalette(palette);
    this.persist(PALETTE_KEY, palette);
  }

  // ── internals ───────────────────────────────────────────────────────────────
  private applyTheme(theme: Theme): void {
    this.theme.set(theme);
    if (isPlatformBrowser(this.platformId)) {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  private applyPalette(palette: Palette): void {
    this.palette.set(palette);
    if (isPlatformBrowser(this.platformId)) {
      document.documentElement.setAttribute('data-palette', palette);
    }
  }

  private persist(key: string, value: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }

  private readTheme(): Theme | null {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'dark' || t === 'light' ? t : null;
    } catch {
      return null;
    }
  }

  private readPalette(): Palette | null {
    try {
      const p = localStorage.getItem(PALETTE_KEY);
      return p === 'regular' || p === 'clarity' ? p : null;
    } catch {
      return null;
    }
  }

  private attrTheme(): Theme | null {
    const t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || t === 'light' ? t : null;
  }

  private attrPalette(): Palette | null {
    const p = document.documentElement.getAttribute('data-palette');
    return p === 'regular' || p === 'clarity' ? p : null;
  }
}
