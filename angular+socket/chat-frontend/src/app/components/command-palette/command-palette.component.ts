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
import { DataService } from '../../services/data.service';
import { SearchService, SearchHit } from '../../services/search.service';

interface Command {
  id: string;
  label: string;
  hint: string;
  group: 'Navigation' | 'Actions';
  keywords: string;
  run: () => void;
}

/**
 * Command palette (⌘K / Ctrl+K).
 * An inline glass dropdown that drops from the topbar search field (its
 * `.cmdk-anchor` parent) with a fuzzy-filtered list of navigation destinations
 * + quick actions. All actions use ONLY existing router navigation and the
 * injected ThemeService — no new contracts. Keyboard: open (⌘/Ctrl+K), ↑/↓
 * move, Enter run, Esc close; closes on any click outside the anchor. All
 * document listeners are SSR-guarded via isPlatformBrowser.
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
  private host = inject(ElementRef<HTMLElement>);
  private data = inject(DataService);
  private search = inject(SearchService);

  readonly isOpen = signal(false);
  readonly query = signal('');
  readonly activeIndex = signal(0);

  // Content-search state (N3): hits from the backend `/search` route, kept
  // separate from the static command list so the two can be rendered as distinct
  // groups yet navigated as one keyboard flow.
  readonly contentResults = signal<SearchHit[]>([]);
  readonly searching = signal(false);
  private searchTimer: any = null;
  private searchSeq = 0; // guards against out-of-order responses

  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('cmdkInput');

  constructor() {
    // Autofocus the search field when the palette opens (browser only).
    effect(() => {
      if (this.isOpen() && isPlatformBrowser(this.platformId)) {
        queueMicrotask(() => this.inputRef()?.nativeElement.focus());
      }
    });

    // Debounced content search: re-runs whenever the query (or open state)
    // changes. Writes land in the async callback, guarded by a sequence number
    // so a slow earlier request can't overwrite a newer one.
    effect(() => {
      const q = this.query().trim();
      const open = this.isOpen();
      if (!isPlatformBrowser(this.platformId)) return;
      if (this.searchTimer) clearTimeout(this.searchTimer);
      if (!open || q.length < 2) {
        this.contentResults.set([]);
        this.searching.set(false);
        return;
      }
      const seq = ++this.searchSeq;
      this.searching.set(true);
      this.searchTimer = setTimeout(() => {
        const username = this.data.getCurrentUser()?.name;
        if (!username) {
          this.searching.set(false);
          return;
        }
        this.search.search(q, username).subscribe({
          next: (r) => {
            if (seq !== this.searchSeq) return;
            this.contentResults.set(r.results ?? []);
            this.searching.set(false);
          },
          error: () => {
            if (seq !== this.searchSeq) return;
            this.contentResults.set([]);
            this.searching.set(false);
          },
        });
      }, 180);
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
      id: 'nav-kanban',
      label: 'Go to Board',
      hint: 'Kanban board',
      group: 'Navigation',
      keywords: 'kanban board columns status todo in progress done lanes',
      run: () => this.router.navigate(['/dashboard/kanban']),
    },
    {
      id: 'nav-timeline',
      label: 'Go to Timeline',
      hint: 'Gantt & dependencies',
      group: 'Navigation',
      keywords: 'timeline gantt dependencies schedule roadmap dependsOn',
      run: () => this.router.navigate(['/dashboard/timeline']),
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

  /** Number of command rows (content rows are indexed after these). */
  readonly commandCount = computed(() => this.results().length);
  /** Total selectable rows across both groups — the keyboard nav domain. */
  readonly totalCount = computed(() => this.results().length + this.contentResults().length);

  isCommandActive(i: number): boolean {
    return this.activeIndex() === i;
  }

  isHitActive(j: number): boolean {
    return this.activeIndex() === this.commandCount() + j;
  }

  open(): void {
    this.query.set('');
    this.activeIndex.set(0);
    this.contentResults.set([]);
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
    const len = this.totalCount();
    if (len === 0) return;
    this.activeIndex.set((this.activeIndex() + delta + len) % len);
  }

  runActive(): void {
    const idx = this.activeIndex();
    const cmds = this.results();
    if (idx < cmds.length) {
      const cmd = cmds[idx];
      if (cmd) this.select(cmd);
      return;
    }
    const hit = this.contentResults()[idx - cmds.length];
    if (hit) this.selectHit(hit);
  }

  select(cmd: Command): void {
    this.close();
    cmd.run();
  }

  /**
   * Open a content hit: resolve its project name to the numeric index the
   * `/dashboard/projects/:id` route expects (projects are addressed by their
   * position in the loaded user, not a DB id), then navigate there. Falls back
   * to the projects list when the project can't be located (e.g. stale hit).
   */
  selectHit(hit: SearchHit): void {
    this.close();
    const projects = this.data.getCurrentUser()?.projects ?? [];
    const index = projects.findIndex((p: any) => p?.name === hit.project_name);
    if (index >= 0) {
      this.router.navigate(['/dashboard/projects', index]);
    } else {
      this.router.navigate(['/dashboard/projects']);
    }
  }

  hitKindLabel(kind: SearchHit['kind']): string {
    switch (kind) {
      case 'task': return 'Task';
      case 'comment': return 'Comment';
      case 'document': return 'Doc';
      default: return 'Element';
    }
  }

  trackById(_: number, cmd: Command): string {
    return cmd.id;
  }

  trackHit(i: number, _hit: SearchHit): number {
    return i;
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

  // Dismiss the dropdown on any click outside its anchor (the search field +
  // panel). The trigger and panel both live inside `.cmdk-anchor`, so clicks
  // on them are ignored here and handled by their own toggle/select.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!isPlatformBrowser(this.platformId) || !this.isOpen()) return;
    const anchor = this.host.nativeElement.parentElement;
    const target = event.target as Node | null;
    if (anchor && target && !anchor.contains(target)) {
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
