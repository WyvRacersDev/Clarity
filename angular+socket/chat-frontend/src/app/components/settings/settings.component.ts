import { Component, OnInit, PLATFORM_ID, Inject, ChangeDetectorRef } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { GoogleIntegrationService } from '../../services/google-integration.service';
import { User, settings } from '../../../../../shared_models/models/user.model';
import { ActivatedRoute, Router } from '@angular/router';
import { getCurrentServerConfig, saveServerConfig } from '../../config/app.config';
import { isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnInit {
  currentUser: User | null = null;
  userSettings: settings | null = null;

  isConnectingCalendar = false;
  isConnectingContacts = false;
  isConnectingGmail = false;
  isProcessingOAuth = false;
  isImportingContacts = false;

  // Contacts
  userContacts: any[] = [];
  importMessage: string = '';
  importSuccess: boolean = false;

  // Server configuration
  serverUrl: string = '';
  isSavingServerConfig = false;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private dataService: DataService,
    private route: ActivatedRoute,
    private router: Router,
    private googleIntegration: GoogleIntegrationService,
    private cdr: ChangeDetectorRef
  ) { }

  async ngOnInit(): Promise<void> {
    console.log('[Settings] ngOnInit started');

    // First, try to get the current user immediately
    const initialUser = this.dataService.getCurrentUser();
    console.log('[Settings] Initial user from getCurrentUser:', initialUser);
    if (initialUser) {
      this.currentUser = initialUser;
      if (initialUser.settings && typeof initialUser.settings.toggle_notif === 'function') {
        this.userSettings = initialUser.settings;
        console.log('[Settings] Initial userSettings set with methods');
      }
    }

    // Load user contacts
    this.loadUserContacts();

    if (isPlatformBrowser(this.platformId)) {
      console.log('[Settings] Running in browser platform');

      // Handle OAuth callback
      const oauthStatus = this.route.snapshot.queryParamMap.get('oauth');
      const tokenId = this.route.snapshot.queryParamMap.get('id');
      console.log('[Settings] OAuth status:', oauthStatus, 'Token ID:', tokenId);
      if (oauthStatus === 'success' && tokenId) {
        localStorage.removeItem("oauth_in_progress");
        // Store the token ID for future use
        localStorage.setItem("gmail_tokenIndex", tokenId);
        console.log('[Settings] OAuth successful, token ID stored:', tokenId);
        // Process OAuth: get email and update username
        await this.processOAuthCallback(tokenId);

        // Clean the URL by removing query params
        this.router.navigate(['/settings'], { replaceUrl: true });
      } else if (this.route.snapshot.queryParamMap.has('oauth')) {
        // OAuth failed or was cancelled
        localStorage.removeItem("oauth_in_progress");
        this.router.navigate(['/settings'], { replaceUrl: true });
      }
    }

    this.dataService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user && user.settings) {
        // Ensure settings has methods (is a class instance, not plain object)
        if (typeof user.settings.toggle_notif === 'function') {
          this.userSettings = user.settings;
        } else {
          // Settings is a plain object, need to get properly reconstructed user
          const reconstructedUser = this.dataService.getCurrentUser();
          if (reconstructedUser) {
            this.currentUser = reconstructedUser;
            this.userSettings = reconstructedUser.settings;
          }
        }
      }
    });

    // Load current server URL
    if (isPlatformBrowser(this.platformId)) {
      this.serverUrl = getCurrentServerConfig();
    }
  }
  /**
       * Process OAuth callback: update username to email and load projects
     * The tokenId parameter is now the email itself (URL encoded)
    
     */
  private async processOAuthCallback(tokenId: string): Promise<void> {
    this.isProcessingOAuth = true;

    try {
      console.log('[Settings] Processing OAuth callback with token ID:', tokenId);

      // The tokenId is now the email directly (URL decoded by Angular)
      const email = decodeURIComponent(tokenId);


      // Check if it looks like an email
      if (email && email.includes('@')) {
        console.log('[Settings] Using email from OAuth callback:', email);

        // Update the username to the email
        const updatedUser = this.dataService.updateUsernameToEmail(email);

        if (updatedUser) {
          console.log('[Settings] Username updated successfully. Loading projects...');

          // Load projects for the new email-based username
          await this.dataService.loadUserProjects();

          console.log('[Settings] OAuth processing complete');
        }
      } else {
        // Fallback: try to get Gmail info from backend (legacy support)
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
    try {
      const result = await this.googleIntegration.connectGoogleCalendar();
      console.log('[Settings] connectGoogleCalendar result:', result);
      if (result && this.userSettings) {
        this.userSettings.allow_google_calender = true;
        this.saveSettings();
      }
      // Trigger change detection to update the UI immediately
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error connecting Google Calendar:', error);
    } finally {
      this.isConnectingCalendar = false;
      // Trigger change detection again when connection completes
      this.cdr.detectChanges();
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
    try {
      const result = await this.googleIntegration.connectGoogleContacts();
      console.log('[Settings] connectGoogleContacts result:', result);
      // Trigger change detection to update the UI immediately
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error connecting Google Contacts:', error);
    } finally {
      this.isConnectingContacts = false;
      // Trigger change detection again when connection completes
      this.cdr.detectChanges();
    }
  }

  disconnectGoogleContacts(): void {
    this.googleIntegration.disconnectGoogleContacts();
  }

  async connectGmail(): Promise<void> {
    this.isConnectingGmail = true;
    try {
      await this.googleIntegration.connectGmail();
      // Note: Gmail uses OAuth redirect, so change detection happens on return
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error connecting Gmail:', error);
    } finally {
      this.isConnectingGmail = false;
      // Trigger change detection again when connection completes
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

      // Try to get the current user if it's null
      if (!this.currentUser) {
        this.currentUser = this.dataService.getCurrentUser();
        console.log('[Settings] Retrieved currentUser:', this.currentUser);
      }

      // Try again after getting user
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

  // Server configuration methods
  saveServerConfig(): void {
    if (!this.serverUrl.trim()) {
      alert('Please enter a valid server URL');
      return;
    }

    // Validate URL format
    try {
      const url = new URL(this.serverUrl);
      // URL is valid
    } catch (e) {
      // Try adding http:// if protocol is missing
      if (!this.serverUrl.startsWith('http://') && !this.serverUrl.startsWith('https://')) {
        this.serverUrl = 'http://' + this.serverUrl;
      } else {
        alert('Please enter a valid server URL (e.g., http://192.168.1.100:3000)');
        return;
      }
    }

    this.isSavingServerConfig = true;
    try {
      saveServerConfig(this.serverUrl);
      alert('Server URL saved successfully! You may need to refresh the page for changes to take effect.');
      // Reload the page to apply new server URL
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Error saving server URL:', error);
      alert('Failed to save server URL');
    } finally {
      this.isSavingServerConfig = false;
    }
  }

  resetServerConfig(): void {
    this.serverUrl = 'http://localhost:3000';
    this.saveServerConfig();
  }
  // Contact import methods
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
        // Refresh contacts list
        this.loadUserContacts();
      }
      // Trigger change detection to update the UI immediately
      this.cdr.detectChanges();
    } catch (error: any) {
      console.error('[Settings] Error importing contacts:', error);
      this.importSuccess = false;
      this.importMessage = `Error: ${error.message}`;
      // Trigger change detection on error
      this.cdr.detectChanges();
    } finally {
      this.isImportingContacts = false;
      // Trigger change detection when import completes
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
