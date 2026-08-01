import { Component, OnInit, OnDestroy, AfterViewInit, PLATFORM_ID, Inject, ChangeDetectorRef, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { GoogleIntegrationService } from '../../services/google-integration.service';
import { User, settings } from '../../../../../shared_models/models/user.model';
import { ActivatedRoute, Router } from '@angular/router';
import { getCurrentServerConfig, saveServerConfig } from '../../config/server.config';
import { isPlatformBrowser } from '@angular/common';
import { ThemeService, Palette } from '../../services/theme.service';
import { IntegrationsService, IntegrationConfig } from '../../services/integrations.service';

type SectionId = 'profile' | 'integrations' | 'server' | 'appearance';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnInit, AfterViewInit, OnDestroy {
  currentUser: User | null = null;
  userSettings: settings | null = null;

  // Local UI state — signals for zoneless safety
  // activeSection now reflects the section currently scrolled into view (scroll-spy).
  activeSection = signal<SectionId>('profile');
  isDarkTheme = signal<boolean>(true);

  private readonly sectionIds: SectionId[] = ['profile', 'integrations', 'server', 'appearance'];
  private scrollObserver: IntersectionObserver | null = null;

  isConnectingCalendar = false;
  isConnectingContacts = false;
  isConnectingGmail = false;
  isProcessingOAuth = false;
  isImportingContacts = false;


  userContacts: any[] = [];
  importMessage: string = '';
  importSuccess: boolean = false;


  serverUrl: string = '';
  isSavingServerConfig = false;
  // B13: inline, non-blocking server-config feedback (replaces blocking alert()).
  serverConfigMessage: string = '';
  serverConfigSuccess: boolean = false;

  // N10: external integrations (ICS calendar feed + outbound webhook/Slack).
  integrationsLoaded = false;
  feedUrl = '';
  webhookUrl = '';
  webhookKind: 'generic' | 'slack' = 'generic';
  isSavingWebhook = false;
  isTestingWebhook = false;
  integrationsMessage = '';
  integrationsSuccess = false;
  copiedFeed = false;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private dataService: DataService,
    private route: ActivatedRoute,
    private router: Router,
    private googleIntegration: GoogleIntegrationService,
    private cdr: ChangeDetectorRef,
    private integrations: IntegrationsService,
    public themeService: ThemeService
  ) { }

  // ── N10: Integrations (ICS feed + webhook/Slack) ──────────────────────────

  private applyIntegrationConfig(cfg: IntegrationConfig): void {
    this.feedUrl = this.integrations.feedUrl(cfg.feedPath);
    this.webhookUrl = cfg.webhookUrl ?? '';
    this.webhookKind = cfg.webhookKind ?? 'generic';
    this.integrationsLoaded = true;
    this.cdr.detectChanges();
  }

  loadIntegrations(): void {
    this.integrations.getConfig().subscribe({
      next: (cfg) => this.applyIntegrationConfig(cfg),
      error: () => { /* not signed in / offline — leave the section collapsed-empty */ },
    });
  }

  private flashIntegrations(message: string, success: boolean): void {
    this.integrationsMessage = message;
    this.integrationsSuccess = success;
    this.cdr.detectChanges();
    setTimeout(() => { this.integrationsMessage = ''; this.cdr.detectChanges(); }, 4000);
  }

  saveWebhook(): void {
    this.isSavingWebhook = true;
    const url = this.webhookUrl.trim() || null;
    this.integrations.setWebhook(url, this.webhookKind).subscribe({
      next: () => { this.isSavingWebhook = false; this.flashIntegrations(url ? 'Webhook saved.' : 'Webhook removed.', true); },
      error: (err) => { this.isSavingWebhook = false; this.flashIntegrations(err?.error?.error ?? 'Could not save webhook.', false); },
    });
  }

  testWebhook(): void {
    this.isTestingWebhook = true;
    this.integrations.testWebhook().subscribe({
      next: (res) => {
        this.isTestingWebhook = false;
        this.flashIntegrations(res.delivered ? 'Test sent — check your webhook.' : 'No webhook configured to test.', res.delivered);
      },
      error: () => { this.isTestingWebhook = false; this.flashIntegrations('Could not send test.', false); },
    });
  }

  regenerateFeed(): void {
    this.integrations.regenerateFeed().subscribe({
      next: (res) => { this.feedUrl = this.integrations.feedUrl(res.feedPath); this.flashIntegrations('New feed link generated. The old link no longer works.', true); },
      error: () => this.flashIntegrations('Could not regenerate the feed link.', false),
    });
  }

  copyFeedUrl(): void {
    if (!this.feedUrl || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(this.feedUrl).then(() => {
      this.copiedFeed = true;
      this.cdr.detectChanges();
      setTimeout(() => { this.copiedFeed = false; this.cdr.detectChanges(); }, 1500);
    }).catch(() => { /* clipboard denied — user can select manually */ });
  }

  async ngOnInit(): Promise<void> {
    console.log('[Settings] ngOnInit started');

    const initialUser = this.dataService.getCurrentUser();
    console.log('[Settings] Initial user from getCurrentUser:', initialUser);
    if (initialUser) {
      this.currentUser = initialUser;
      if (initialUser.settings && typeof initialUser.settings.toggle_notif === 'function') {
        this.userSettings = initialUser.settings;
        console.log('[Settings] Initial userSettings set with methods');
      }
    }


    this.loadUserContacts();

    if (isPlatformBrowser(this.platformId)) {
      this.loadIntegrations();
      console.log('[Settings] Running in browser platform');


      const oauthStatus = this.route.snapshot.queryParamMap.get('oauth');
      const tokenId = this.route.snapshot.queryParamMap.get('id');
      console.log('[Settings] OAuth status:', oauthStatus, 'Token ID:', tokenId);
      if (oauthStatus === 'success' && tokenId) {
        localStorage.removeItem("oauth_in_progress");

        localStorage.setItem("gmail_tokenIndex", tokenId);
        console.log('[Settings] OAuth successful, token ID stored:', tokenId);

        await this.processOAuthCallback(tokenId);


        this.router.navigate(['/dashboard/settings'], { replaceUrl: true });
      } else if (this.route.snapshot.queryParamMap.has('oauth')) {

        localStorage.removeItem("oauth_in_progress");
        this.router.navigate(['/dashboard/settings'], { replaceUrl: true });
      }
    }

    this.dataService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user && user.settings) {
         if (typeof user.settings.toggle_notif === 'function') {
          this.userSettings = user.settings;
        } else {
           const reconstructedUser = this.dataService.getCurrentUser();
          if (reconstructedUser) {
            this.currentUser = reconstructedUser;
            this.userSettings = reconstructedUser.settings;
          }
        }
      }
    });


    if (isPlatformBrowser(this.platformId)) {
      this.serverUrl = getCurrentServerConfig();
      // Read current theme from document attribute (set by the layout theme toggle)
      const currentTheme = document.documentElement.getAttribute('data-theme');
      this.isDarkTheme.set(currentTheme !== 'light');
    }
  }

  private async processOAuthCallback(tokenId: string): Promise<void> {
    this.isProcessingOAuth = true;

    try {
      console.log('[Settings] Processing OAuth callback with token ID:', tokenId);

           const email = decodeURIComponent(tokenId);


       if (email && email.includes('@')) {
        console.log('[Settings] Using email from OAuth callback:', email);

         const updatedUser = this.dataService.updateUsernameToEmail(email);

        if (updatedUser) {
          console.log('[Settings] Username updated successfully. Loading projects...');

             await this.dataService.loadUserProjects();

          console.log('[Settings] OAuth processing complete');
        }
      } else {
          console.log('[Settings] Token ID is not an email, trying backend lookup...');
        try {
          const gmailInfo = await this.googleIntegration.getGmailInfo(tokenId);
          if (gmailInfo && gmailInfo.email) {
            const fetchedEmail = gmailInfo.email;
            console.log('[Settings] Got email from backend:', fetchedEmail);

            const updatedUser = this.dataService.updateUsernameToEmail(fetchedEmail);
            if (updatedUser) {
              await this.dataService.loadUserProjects();
            }
          }
        } catch (backendError) {
          console.error('[Settings] Backend lookup failed:', backendError);
        }
      }
    } catch (error) {
      console.error('[Settings] Error processing OAuth callback:', error);
    } finally {
      this.isProcessingOAuth = false;
    }
  }

  /**
   * Sidebar click → smooth-scroll to the matching section on the same page.
   * No route change; SSR-safe (guards document access).
   */
  setActiveSection(section: SectionId): void {
    this.activeSection.set(section);
    if (!isPlatformBrowser(this.platformId)) return;
    const el = document.getElementById('section-' + section);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // Scroll-spy: highlight the sidebar item for whichever section is in view.
    if (typeof IntersectionObserver === 'undefined') return;
    this.scrollObserver = new IntersectionObserver(
      (entries) => {
        // Pick the entry nearest the top that is intersecting.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = visible[0].target.getAttribute('data-section') as SectionId | null;
          if (id) this.activeSection.set(id);
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    );
    for (const id of this.sectionIds) {
      const el = document.getElementById('section-' + id);
      if (el) this.scrollObserver.observe(el);
    }
  }

  ngOnDestroy(): void {
    this.scrollObserver?.disconnect();
    this.scrollObserver = null;
  }

  setTheme(dark: boolean): void {
    // Route through the shared ThemeService so the topbar toggle signal, the
    // persisted key, and the `data-theme` attribute all stay in sync.
    this.themeService.setTheme(dark ? 'dark' : 'light');
    this.isDarkTheme.set(dark);
  }

  /** Switch the colour world (regular ⇄ clarity). The theme toggle keeps
   *  switching light/dark within whichever palette is active. */
  setPalette(palette: Palette): void {
    this.themeService.setPalette(palette);
  }

  toggleNotifications(): void {
    if (this.userSettings) {
      this.userSettings.toggle_notif();
      this.saveSettings();
    }
  }

  toggleInvites(): void {
    if (this.userSettings) {
      this.userSettings.toggle_invite();
      this.saveSettings();
    }
  }

  toggleGoogleCalendar(): void {
    if (this.userSettings) {
      this.userSettings.toggle_calender();
      this.saveSettings();
    }
  }

  async connectGoogleCalendar(): Promise<void> {
    this.isConnectingCalendar = true;

    if(this.googleIntegration.isGmailConnected())
    {
      try {
        const result = await this.googleIntegration.connectGoogleCalendar();
        console.log('[Settings] connectGoogleCalendar result:', result);
        if (result && this.userSettings) {
          this.userSettings.allow_google_calender = true;
          this.saveSettings();
        }
           this.cdr.detectChanges();
      } catch (error) {
        console.error('Error connecting Google Calendar:', error);
      } finally {
        this.isConnectingCalendar = false;
         this.cdr.detectChanges();
      }
    }
    else
    {
      this.isConnectingCalendar = false;
      this.saveSettings();
    }
  }

  disconnectGoogleCalendar(): void {
    this.googleIntegration.disconnectGoogleCalendar();
    if (this.userSettings) {
      this.userSettings.allow_google_calender = false;
      this.saveSettings();
    }
  }

  async connectGoogleContacts(): Promise<void> {
    this.isConnectingContacts = true;
    if(this.googleIntegration.isGmailConnected())
      {
      try {
        const result = await this.googleIntegration.connectGoogleContacts();
        console.log('[Settings] connectGoogleContacts result:', result);
           this.cdr.detectChanges();
      } catch (error) {
        console.error('Error connecting Google Contacts:', error);
      } finally {
        this.isConnectingContacts = false;
          this.cdr.detectChanges();
      }
    }
    else
    {
      this.isConnectingContacts = false;
      this.saveSettings();
    }
  }

  disconnectGoogleContacts(): void {
    this.googleIntegration.disconnectGoogleContacts();
  }

  async connectGmail(): Promise<void> {
    this.isConnectingGmail = true;
    try {
      await this.googleIntegration.connectGmail();
         this.cdr.detectChanges();
    } catch (error) {
      console.error('Error connecting Gmail:', error);
    } finally {
      this.isConnectingGmail = false;
        this.cdr.detectChanges();
    }
  }

  disconnectGmail(): void {
    this.googleIntegration.disconnectGmail();
  }

  private saveSettings(): void {
    console.log('[Settings] saveSettings called');
    console.log('[Settings] userSettings:', this.userSettings);
    console.log('[Settings] currentUser:', this.currentUser);

    if (this.userSettings && this.currentUser) {
      console.log('[Settings] Calling dataService.updateSettings');
      this.dataService.updateSettings(this.userSettings);
    } else {
      console.warn('[Settings] Cannot save settings - userSettings or currentUser is null');

       if (!this.currentUser) {
        this.currentUser = this.dataService.getCurrentUser();
        console.log('[Settings] Retrieved currentUser:', this.currentUser);
      }

      if (this.userSettings && this.currentUser) {
        console.log('[Settings] Retrying dataService.updateSettings');
        this.dataService.updateSettings(this.userSettings);
      }
    }
  }

  isGoogleCalendarConnected(): boolean {
    const connected = this.googleIntegration.isCalendarConnected();
    console.log('[Settings] isGoogleCalendarConnected check:', connected);
    return connected;
  }

  isGoogleContactsConnected(): boolean {
    return this.googleIntegration.isContactsConnected();
  }

  isGmailConnected(): boolean {
    return this.googleIntegration.isGmailConnected();
  }

  saveServerConfig(): void {
    // B13: clear any prior notice, then surface all feedback inline (no blocking alert()).
    this.setServerConfigNotice('', false);

    if (!this.serverUrl.trim()) {
      this.setServerConfigNotice('Please enter a valid server URL.', false);
      return;
    }


    try {
      const url = new URL(this.serverUrl);

    } catch (e) {

      if (!this.serverUrl.startsWith('http://') && !this.serverUrl.startsWith('https://')) {
        this.serverUrl = 'http://' + this.serverUrl;
      } else {
        this.setServerConfigNotice('Please enter a valid server URL (e.g. http://192.168.1.100:3000).', false);
        return;
      }
    }

    this.isSavingServerConfig = true;
    try {
      saveServerConfig(this.serverUrl);
      this.setServerConfigNotice('Server URL saved. Reloading to reconnect…', true);
      // A14: SSR guard — `window` is browser-only. Reached from a user click, but
      // guard defensively so a server render never dereferences `window`.
      if (isPlatformBrowser(this.platformId)) {
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    } catch (error) {
      console.error('Error saving server URL:', error);
      this.setServerConfigNotice('Failed to save server URL. Please try again.', false);
    } finally {
      this.isSavingServerConfig = false;
    }
  }

  /** B13: set the inline server-config notice + severity, zoneless-safe. */
  private setServerConfigNotice(message: string, success: boolean): void {
    this.serverConfigMessage = message;
    this.serverConfigSuccess = success;
    this.cdr.markForCheck();
  }

  resetServerConfig(): void {
    this.serverUrl = 'http://localhost:3000';
    this.saveServerConfig();
  }

  async importGoogleContacts(): Promise<void> {
    if (!this.userSettings?.allow_invite) {
      this.importMessage = 'Enable "Allow Invites" to import contacts';
      this.importSuccess = false;
      return;
    }

    this.isImportingContacts = true;
    this.importMessage = '';

    try {
      console.log('[Settings] Starting Google Contacts import...');
      const result = await this.dataService.importGoogleContacts();

      this.importSuccess = result.success;
      this.importMessage = result.message;

      if (result.success) {

        this.loadUserContacts();
      }
         this.cdr.detectChanges();
    } catch (error: any) {
      console.error('[Settings] Error importing contacts:', error);
      this.importSuccess = false;
      this.importMessage = `Error: ${error.message}`;

      this.cdr.detectChanges();
    } finally {
      this.isImportingContacts = false;
      this.cdr.detectChanges();
    }
  }

  loadUserContacts(): void {
    this.userContacts = this.dataService.getUserContacts();
    console.log('[Settings] Loaded contacts:', this.userContacts);
  }

  canImportContacts(): boolean {
    return this.userSettings?.allow_invite === true && this.isGmailConnected();
  }

}
