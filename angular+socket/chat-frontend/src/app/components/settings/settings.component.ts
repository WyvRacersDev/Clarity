import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { GoogleIntegrationService } from '../../services/google-integration.service';
import { User, settings } from '../../../../../shared_models/models/user.model';

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

  constructor(
    private dataService: DataService,
    private googleIntegration: GoogleIntegrationService
  ) {}

  ngOnInit(): void {
    this.dataService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.userSettings = user.settings;
      }
    });
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
}
