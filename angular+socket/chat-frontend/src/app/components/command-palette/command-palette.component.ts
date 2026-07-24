import {
  Component,
  ElementRef,
  HostListener,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { ThemeService } from '../../services/theme.service';

interface Command {
  id: string;
  label: string;
  hint: string;
  group: 'Navigation' | 'Actions';
  keywords: string;
  run: () => void;
}

/**
 * Aurora command palette (⌘K / Ctrl+K).
 * Glass modal with a fuzzy-filtered list of navigation destinations + quick
 * actions. All actions use ONLY existing router navigation and the injected
 * ThemeService — no new contracts. Keyboard: open (⌘/Ctrl+K), ↑/↓ move,
 * Enter run, Esc close. SSR-guarded keydown listener via HostListener guard.
 */
@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [],
  templateUrl: './command-palette.component.html',
  styleUrls: ['./command-palette.component.css'],
})
export class CommandPaletteComponent {
  private router = inject(Router);
  private theme = inject(ThemeService);
  private platformId = inject(PLATFORM_ID);

  readonly isOpen = signal(false);
  readonly query = signal('');
  readonly activeIndex = signal(0);

  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('cmdkInput');

  constructor() {
    // Autofocus the search field when the palette opens (browser only).
    effect(() => {
      if (this.isOpen() && isPlatformBrowser(this.platformId)) {
        queueMicrotask(() => this.inputRef()?.nativeElement.focus());
      }
    });
  }

  private readonly commands: Command[] = [
    {
      id: 'nav-dashboard',
      label: 'Go to Dashboard',
      hint: 'Overview',
      group: 'Navigation',
      keywords: 'dashboard home overview today',
      run: () => this.router.navigate(['/dashboard']),
    },
    {
      id: 'nav-projects',
      label: 'Go to Projects',
      hint: 'All projects',
      group: 'Navigation',
      keywords: 'projects boards workspace',
      run: () => this.router.navigate(['/dashboard/projects']),
    },
    {
      id: 'nav-tasks',
      label: 'Go to Tasks',
      hint: 'Tasks & Calendar',
      group: 'Navigation',
      keywords: 'tasks calendar todo due',
      run: () => this.router.navigate(['/dashboard/tasks']),
    },
    {
      id: 'nav-analytics',
      label: 'Go to Analytics',
      hint: 'Insights & charts',
      group: 'Navigation',
      keywords: 'analytics charts stats metrics reports',
      run: () => this.router.navigate(['/dashboard/analytics']),
    },
    {
      id: 'nav-ai',
      label: 'Go to AI Insights',
      hint: 'Ask the assistant',
      group: 'Navigation',
      keywords: 'ai insights assistant chat ml',
      run: () => this.router.navigate(['/dashboard/ai-insights']),
    },
    {
      id: 'nav-settings',
      label: 'Go to Settings',
      hint: 'Profile & preferences',
      group: 'Navigation',
      keywords: 'settings profile integrations preferences account',
      run: () => this.router.navigate(['/dashboard/settings']),
    },
    {
      id: 'act-new-project',
      label: 'New Project',
      hint: 'Create a project',
      group: 'Actions',
      keywords: 'new create project add',
      run: () =>
        this.router.navigate(['/dashboard/projects'], {
          queryParams: { new: 1 },
        }),
    },
    {
      id: 'act-toggle-theme',
      label: 'Toggle theme',
      hint: 'Dark / Light',
      group: 'Actions',
      keywords: 'theme dark light appearance toggle mode',
      run: () => this.theme.toggle(),
    },
  ];

  /** Fuzzy subsequence filter over label + keywords. */
  readonly results = computed<Command[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.commands;
    return this.commands
      .map((c) => ({ c, score: this.score(q, c) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.c);
  });

  open(): void {
    this.query.set('');
    this.activeIndex.set(0);
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  toggle(): void {
    this.isOpen() ? this.close() : this.open();
  }

  onQueryInput(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
  }

  move(delta: number): void {
    const len = this.results().length;
    if (len === 0) return;
    this.activeIndex.set((this.activeIndex() + delta + len) % len);
  }

  runActive(): void {
    const list = this.results();
    const cmd = list[this.activeIndex()];
    if (cmd) this.select(cmd);
  }

  select(cmd: Command): void {
    this.close();
    cmd.run();
  }

  trackById(_: number, cmd: Command): string {
    return cmd.id;
  }

  // Global ⌘/Ctrl+K shortcut — guarded by platform check.
  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const key = event.key?.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 'k') {
      event.preventDefault();
      this.toggle();
      return;
    }
    if (this.isOpen() && key === 'escape') {
      event.preventDefault();
      this.close();
    }
  }

  // Keydown within the palette (search field / list navigation).
  onPaletteKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.move(-1);
        break;
      case 'Enter':
        event.preventDefault();
        this.runActive();
        break;
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
    }
  }

  private score(q: string, cmd: Command): number {
    const hay = (cmd.label + ' ' + cmd.keywords).toLowerCase();
    // Contiguous substring is a strong match.
    if (hay.includes(q)) return 100 - hay.indexOf(q);
    // Fuzzy subsequence fallback.
    let qi = 0;
    for (let i = 0; i < hay.length && qi < q.length; i++) {
      if (hay[i] === q[qi]) qi++;
    }
    return qi === q.length ? 40 : 0;
  }
}
