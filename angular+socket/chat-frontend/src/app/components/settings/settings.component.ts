import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { GoogleIntegrationService } from '../../services/google-integration.service';
import { User, settings } from '../../../../../shared_models/models/user.model';
import { ActivatedRoute } from '@angular/router';
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
  
  // Server configuration
  serverUrl: string = '';
  isSavingServerConfig = false;

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
    private googleIntegration: GoogleIntegrationService
  ) {}

  ngOnInit(): void {
      if (this.route.snapshot.queryParamMap.has('oauth')) {
    localStorage.removeItem("oauth_in_progress");
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
