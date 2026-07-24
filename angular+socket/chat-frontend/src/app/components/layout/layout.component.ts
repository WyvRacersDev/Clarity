import {
  Component,
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
import { TourOverlayComponent } from '../tour/tour-overlay.component';
import { TourService } from '../../services/tour.service';

const SIDEBAR_KEY = 'clarity-sidebar-collapsed';

interface NavItem {
  label: string;
  link: string;
  exact: boolean;
  icon: string; // key into iconFor()
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
  imports: [RouterModule, CommandPaletteComponent, TourOverlayComponent],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css'],
})
export class LayoutComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private google_service = inject(GoogleIntegrationService);
  private platformId = inject(PLATFORM_ID);
  private tour = inject(TourService);
  readonly themeService = inject(ThemeService);

  currentUser: any = null;

  /** Sidebar collapsed (rail) state — persisted, SSR-guarded. */
  readonly collapsed = signal(false);
  /** User menu open state at the sidebar footer. */
  readonly userMenuOpen = signal(false);
  /** Current page title, derived from the active route. */
  readonly pageTitle = signal('Dashboard');

  readonly navItems: NavItem[] = [
    { label: 'Dashboard', link: '/dashboard', exact: true, icon: 'grid' },
    { label: 'Projects', link: '/dashboard/projects', exact: false, icon: 'folder' },
    { label: 'Tasks & Calendar', link: '/dashboard/tasks', exact: false, icon: 'check' },
    { label: 'Analytics', link: '/dashboard/analytics', exact: false, icon: 'chart' },
    { label: 'AI Insights', link: '/dashboard/ai-insights', exact: false, icon: 'ai' },
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
      .subscribe((e) => this.syncTitle(e.urlAfterRedirects));

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
  }

  toggleSidebar(): void {
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

  toggleUserMenu(): void {
    this.userMenuOpen.set(!this.userMenuOpen());
  }

  closeUserMenu(): void {
    this.userMenuOpen.set(false);
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

  private syncTitle(url: string): void {
    const match = this.navItems
      .filter((n) => (n.exact ? url === n.link : url.startsWith(n.link)))
      .sort((a, b) => b.link.length - a.link.length)[0];
    this.pageTitle.set(match?.label ?? 'Dashboard');
  }
}
