import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { GoogleIntegrationService } from '../../services/google-integration.service';
import { User, settings } from '../../../../../shared_models/models/user.model';
import { ActivatedRoute , Router } from '@angular/router';
import { getCurrentServerConfig, saveServerConfig } from '../../config/app.config';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
  
  // Server configuration
  serverUrl: string = '';
  isSavingServerConfig = false;

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
        private router: Router,
    private googleIntegration: GoogleIntegrationService
  ) {}

 async ngOnInit(): Promise<void> {
    // Handle OAuth callback
    const oauthStatus = this.route.snapshot.queryParamMap.get('oauth');
    const tokenId = this.route.snapshot.queryParamMap.get('id');
    
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
    this.dataService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.userSettings = user.settings;
      }
    });
    
    // Load current server URL
    this.serverUrl = getCurrentServerConfig();
  }
/**
   * Process OAuth callback: fetch Gmail user info, update username to email, and load projects
   */
  private async processOAuthCallback(tokenId: string): Promise<void> {
    this.isProcessingOAuth = true;
    
    try {
      console.log('[Settings] Processing OAuth callback with token ID:', tokenId);
      
      // Get Gmail user info
      const gmailInfo = await this.googleIntegration.getGmailInfo(tokenId);
      console.log('[Settings] Gmail user info:', gmailInfo);
      
      if (gmailInfo && gmailInfo.email) {
        const email = gmailInfo.email;
        console.log('[Settings] Updating username to email:', email);
        
        // Update the username to the email
        const updatedUser = this.dataService.updateUsernameToEmail(email);
        
        if (updatedUser) {
          console.log('[Settings] Username updated successfully. Loading projects...');
          
          // Load projects for the new email-based username
          await this.dataService.loadUserProjects();
          
          console.log('[Settings] OAuth processing complete');
        } } else {
        console.error('[Settings] No email found in Gmail info:', gmailInfo);
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
      await this.googleIntegration.connectGoogleCalendar();
      if (this.userSettings) {
        this.userSettings.allow_google_calender = true;
        this.saveSettings();
      }
    } catch (error) {
      console.error('Error connecting Google Calendar:', error);
    } finally {
      this.isConnectingCalendar = false;
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
      await this.googleIntegration.connectGoogleContacts();
    } catch (error) {
      console.error('Error connecting Google Contacts:', error);
    } finally {
      this.isConnectingContacts = false;
    }
  }

  disconnectGoogleContacts(): void {
    this.googleIntegration.disconnectGoogleContacts();
  }

  async connectGmail(): Promise<void> {
    this.isConnectingGmail = true;
    try {
      await this.googleIntegration.connectGmail();
    } catch (error) {
      console.error('Error connecting Gmail:', error);
    } finally {
      this.isConnectingGmail = false;
    }
  }

  disconnectGmail(): void {
    this.googleIntegration.disconnectGmail();
  }

  private saveSettings(): void {
    if (this.userSettings && this.currentUser) {
      this.dataService.updateSettings(this.userSettings);
    }
  }

  isGoogleCalendarConnected(): boolean {
    return this.googleIntegration.isCalendarConnected();
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
}
