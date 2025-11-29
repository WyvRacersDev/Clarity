import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { User, settings } from '../../../../shared_models/models/user.model';
import { DataService } from './data.service';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { getServerConfig } from '../config/app.config';


@Injectable({
  providedIn: 'root'
})
export class GoogleIntegrationService {
  private isGoogleCalendarConnected = false;
  private isGoogleContactsConnected = false;
  private isGmailConnectedStatus = false;

  constructor(
    private dataService: DataService,
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    // Load connection status from localStorage
    this.loadConnectionStatus();
  }
    private getServerUrl(): string {
    return getServerConfig();
  }

  connectGoogleCalendar(): Promise<boolean> {
    // In a real implementation, this would use Google OAuth
    // For now, we'll simulate the connection
    return new Promise((resolve) => {
      setTimeout(() => {
        this.isGoogleCalendarConnected = true;
        this.saveConnectionStatus();
        this.updateUserSettings();
        resolve(true);
      }, 1000);
    });
  }

  disconnectGoogleCalendar(): void {
    this.isGoogleCalendarConnected = false;
    this.saveConnectionStatus();
    this.updateUserSettings();
  }

  connectGoogleContacts(): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.isGoogleContactsConnected = true;
        this.saveConnectionStatus();
        this.updateUserSettings();
        resolve(true);
      }, 1000);
    });
  }

  disconnectGoogleContacts(): void {
    this.isGoogleContactsConnected = false;
    this.saveConnectionStatus();
    this.updateUserSettings();
  }

// 
async connectGmail(): Promise<any>  {
    await this.saveFrontendUrl();
    localStorage.setItem("oauth_in_progress", "1");
  window.location.href = `${this.getServerUrl()}/auth`;
    this.isGmailConnectedStatus = true;
    this.saveConnectionStatus();
    this.updateUserSettings();
  }

  getGmailInfo(tokenId?: string): Promise<any> {
    const id = tokenId || localStorage.getItem("gmail_tokenIndex");
    console.log("Gmail token ID:", id);
    return firstValueFrom(this.http.get<any>(`${this.getServerUrl()}/gmail/user-info?id=${id}`));
  }

  disconnectGmail(): void {
    this.isGmailConnectedStatus = false;
    this.saveConnectionStatus();
    this.updateUserSettings();
  }

  isCalendarConnected(): boolean {
    return this.isGoogleCalendarConnected;
  }

  isContactsConnected(): boolean {
    return this.isGoogleContactsConnected;
  }

  isGmailConnected(): boolean {
    return this.isGmailConnectedStatus;
  }

  private updateUserSettings(): void {
    const user = this.dataService.getCurrentUser();
    if (user) {
      user.settings.allow_google_calender = this.isGoogleCalendarConnected;
      this.dataService.updateSettings(user.settings);
    }
  }

  private saveConnectionStatus(): void {
    // Only access localStorage in browser environment
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    localStorage.setItem('google_integrations', JSON.stringify({
      calendar: this.isGoogleCalendarConnected,
      contacts: this.isGoogleContactsConnected,
      gmail: this.isGmailConnectedStatus
    }));
  }

  private loadConnectionStatus(): void {
    // Only access localStorage in browser environment
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const saved = localStorage.getItem('google_integrations');
    if (saved) {
      try {
        const status = JSON.parse(saved);
        this.isGoogleCalendarConnected = status.calendar || false;
        this.isGoogleContactsConnected = status.contacts || false;
        this.isGmailConnectedStatus = status.gmail || false;
      } catch (e) {
        console.error('Error loading Google integration status:', e);
      }
    }
  }
  saveFrontendUrl(): Promise<void> {
  const frontendUrl = window.location.origin;

 return fetch(`${this.getServerUrl()}/set-redirect-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frontendUrl })
    }).then(() => {});
  }
}

