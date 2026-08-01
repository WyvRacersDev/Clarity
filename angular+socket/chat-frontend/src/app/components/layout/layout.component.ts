import {
  Component,
  HostListener,
  OnInit,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { GoogleIntegrationService } from '../../services/google-integration.service';
import { ThemeService } from '../../services/theme.service';
import { CommandPaletteComponent } from '../command-palette/command-palette.component';
import { NotificationBellComponent } from '../notification-bell/notification-bell.component';
import { TourOverlayComponent } from '../tour/tour-overlay.component';
import { TourService } from '../../services/tour.service';
import { SocketService } from '../../services/socket.service';
import { ChatPanelComponent } from '../chat/chat-panel.component';
import { ChatUiService } from '../../services/chat-ui.service';

const SIDEBAR_KEY = 'clarity-sidebar-collapsed';

interface NavItem {
  label: string;
  link: string;
  exact: boolean;
  icon: string; // key into iconFor()
}

/** N7: a transient @mention toast surfaced from the shell. */
interface MentionToast {
  id: number;
  author: string;
  body: string;
}

/**
 * Aurora layout shell — collapsible sidebar, glass topbar, command palette,
 * theme toggle. SSR-safe (all storage guarded via isPlatformBrowser) and
 * zoneless-safe (signals). Preserves the existing logout() behavior and every
 * nav destination.
 */
@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterModule, CommandPaletteComponent, NotificationBellComponent, TourOverlayComponent, ChatPanelComponent],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css'],
})
export class LayoutComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private google_service = inject(GoogleIntegrationService);
  private platformId = inject(PLATFORM_ID);
  private tour = inject(TourService);
  private socket = inject(SocketService);
  readonly themeService = inject(ThemeService);
  readonly chatUi = inject(ChatUiService);

  currentUser: any = null;

  /** N7: active @mention toasts (transient; auto-dismissed). */
  readonly mentionToasts = signal<MentionToast[]>([]);
  private mentionToastSeq = 0;

  /** Sidebar collapsed (rail) state — persisted, SSR-guarded. */
  readonly collapsed = signal(false);
  /** B14: mobile off-canvas drawer open state (only meaningful below the mobile breakpoint). */
  readonly mobileOpen = signal(false);
  /** User menu open state at the sidebar footer (bottom-left avatar). */
  readonly userMenuOpen = signal(false);
  /** User menu open state at the topbar (top-right avatar). */
  readonly topUserMenuOpen = signal(false);
  /** Current page title, derived from the active route. */
  readonly pageTitle = signal('Dashboard');

  // T2 sidebar order (from B, with Analytics before Insights/Assistant):
  // Dashboard → Projects → Tasks → Analytics → Insights → Assistant → Contacts → Settings.
  // Assistant/Contacts routes are added in T11/T12; links point at their final paths.
  readonly navItems: NavItem[] = [
    { label: 'Dashboard', link: '/dashboard', exact: true, icon: 'grid' },
    { label: 'Projects', link: '/dashboard/projects', exact: false, icon: 'folder' },
    { label: 'Tasks', link: '/dashboard/tasks', exact: false, icon: 'check' },
    { label: 'Board', link: '/dashboard/kanban', exact: false, icon: 'board' },
    { label: 'Timeline', link: '/dashboard/timeline', exact: false, icon: 'timeline' },
    { label: 'Analytics', link: '/dashboard/analytics', exact: false, icon: 'chart' },
    { label: 'Insights', link: '/dashboard/ai-insights', exact: false, icon: 'ai' },
    { label: 'Assistant', link: '/dashboard/assistant', exact: false, icon: 'assistant' },
    { label: 'Contacts', link: '/dashboard/contacts', exact: false, icon: 'contacts' },
    { label: 'Messages', link: '/dashboard/messages', exact: false, icon: 'chat' },
    { label: 'Settings', link: '/dashboard/settings', exact: false, icon: 'settings' },
  ];

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();

    if (isPlatformBrowser(this.platformId)) {
      try {
        this.collapsed.set(localStorage.getItem(SIDEBAR_KEY) === 'true');
      } catch {
        /* storage unavailable — keep expanded */
      }
    }

    this.syncTitle(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.syncTitle(e.urlAfterRedirects);
        // B14: navigating always dismisses the mobile drawer.
        this.mobileOpen.set(false);
      });

    // Auto-start the onboarding tour once, on the first authed load only:
    // browser-only, a user is present, and the tour hasn't been seen before.
    // Deferred so the sidebar/topbar targets are painted before we measure.
    if (
      isPlatformBrowser(this.platformId) &&
      this.currentUser &&
      !this.tour.hasSeenTour()
    ) {
      setTimeout(() => this.tour.maybeAutoStart(), 400);
    }

    // N7: surface @mentions from anywhere in the app as a transient toast.
    if (isPlatformBrowser(this.platformId)) {
      this.socket.onMentionNotified().subscribe((m) => this.pushMentionToast(m));
    }
  }

  private pushMentionToast(m: { author?: string; body?: string }): void {
    const id = ++this.mentionToastSeq;
    this.mentionToasts.update((list) => [
      ...list,
      { id, author: m?.author ?? 'Someone', body: m?.body ?? '' },
    ]);
    setTimeout(() => this.dismissMentionToast(id), 6000);
  }

  dismissMentionToast(id: number): void {
    this.mentionToasts.update((list) => list.filter((t) => t.id !== id));
  }

  toggleSidebar(): void {
    // B14: below the mobile breakpoint the menu button drives the off-canvas
    // drawer instead of the desktop rail collapse.
    if (this.isMobileViewport()) {
      this.mobileOpen.set(!this.mobileOpen());
      return;
    }
    const next = !this.collapsed();
    this.collapsed.set(next);
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(SIDEBAR_KEY, String(next));
      } catch {
        /* non-fatal */
      }
    }
  }

  /** B14: dismiss the mobile off-canvas drawer (scrim click / Escape). */
  closeMobileNav(): void {
    this.mobileOpen.set(false);
  }

  private isMobileViewport(): boolean {
    return (
      isPlatformBrowser(this.platformId) &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 900px)').matches
    );
  }

  toggleUserMenu(event?: Event): void {
    // Stop the click from reaching the document listener that would immediately
    // re-close the menu we're opening.
    event?.stopPropagation();
    this.userMenuOpen.set(!this.userMenuOpen());
    this.topUserMenuOpen.set(false);
  }

  closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  toggleTopUserMenu(event?: Event): void {
    event?.stopPropagation();
    this.topUserMenuOpen.set(!this.topUserMenuOpen());
    this.userMenuOpen.set(false);
  }

  /** Dismiss both user menus on any click outside their toggle buttons. */
  @HostListener('document:click')
  closeUserMenus(): void {
    if (this.userMenuOpen()) this.userMenuOpen.set(false);
    if (this.topUserMenuOpen()) this.topUserMenuOpen.set(false);
  }

  /** Escape also dismisses the open user menus. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeUserMenus();
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  isDark(): boolean {
    return this.themeService.isDark();
  }

  logout(): void {
    this.authService.logout();
    this.google_service.disconnectGmail();
  }

  get userInitial(): string {
    return (this.currentUser?.name?.charAt(0) || 'U').toUpperCase();
  }

  /** OAuth avatar URL, if the signed-in user has one (else null → show initial). */
  get userPicture(): string | null {
    return (this.currentUser as any)?.picture || null;
  }

  private syncTitle(url: string): void {
    const match = this.navItems
      .filter((n) => (n.exact ? url === n.link : url.startsWith(n.link)))
      .sort((a, b) => b.link.length - a.link.length)[0];
    this.pageTitle.set(match?.label ?? 'Dashboard');
  }
}
