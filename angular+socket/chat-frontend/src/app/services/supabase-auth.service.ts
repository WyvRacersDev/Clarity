import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable } from 'rxjs';
import { User, settings, contact } from '../../../../shared_models/models/user.model';
import { SupabaseService } from './supabase.service';

export interface AuthState {
  isAuthenticated: boolean;
  user?: any;
}

@Injectable({
  providedIn: 'root'
})
export class SupabaseAuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();

  private authStateSubject = new BehaviorSubject<AuthState | null>(null);
  public authState$: Observable<AuthState | null> = this.authStateSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$: Observable<boolean> = this.loadingSubject.asObservable();

  constructor(
    private supabaseService: SupabaseService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    if (isPlatformBrowser(this.platformId)) {
      this.loadSession();
      this.listenForAuthChanges();
    }
  }

  private async loadSession(): Promise<void> {
    try {
      const { data: { session } } = await this.supabaseService.client.auth.getSession();
      if (session?.user) {
        const profile = await this.getOrCreateProfile(session.user.id, session.user.email || '');
        if (profile) {
          this.currentUserSubject.next(profile);
          this.authStateSubject.next({ isAuthenticated: true, user: session.user });
        }
      }
    } catch (error) {
      console.error('Error loading session:', error);
    }
  }

  private listenForAuthChanges(): void {
    this.supabaseService.client.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const profile = await this.getOrCreateProfile(session.user.id, session.user.email || '');
        if (profile) {
          this.currentUserSubject.next(profile);
          this.authStateSubject.next({ isAuthenticated: true, user: session.user });
        }
      } else if (event === 'SIGNED_OUT') {
        this.currentUserSubject.next(null);
        this.authStateSubject.next({ isAuthenticated: false });
      }
    });
  }

  async signUp(email: string, password: string): Promise<{ error: string | null; data: any } | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return { error: 'Not in browser environment', data: null };
    }
    this.loadingSubject.next(true);
    try {
      const { data, error } = await this.supabaseService.client.auth.signUp({
        email,
        password,
        options: {
          data: {
            autoSignIn: true
          }
        }
      });

      if (error) {
        console.error('Error signing up:', error);
        this.loadingSubject.next(false);
        return { error: error.message, data: null };
      }

      if (data?.user) {
        const profile = await this.getOrCreateProfile(data.user.id, email);
        if (profile) {
          this.currentUserSubject.next(profile);
          this.authStateSubject.next({ isAuthenticated: true, user: data.user });
        }
        this.loadingSubject.next(false);
        return { error: null, data: { user: profile, session: data.session } };
      }
      this.loadingSubject.next(false);
      return null;
    } catch (err) {
      this.loadingSubject.next(false);
      return { error: String(err), data: null };
    }
  }

  async signIn(email: string, password: string): Promise<{ error: string | null; data: any } | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return { error: 'Not in browser environment', data: null };
    }
    this.loadingSubject.next(true);
    try {
      const { data, error } = await this.supabaseService.client.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        console.error('Error signing in:', error);
        this.loadingSubject.next(false);
        return { error: error.message, data: null };
      }

      if (data?.user) {
        const profile = await this.getOrCreateProfile(data.user.id, email);
        if (profile) {
          this.currentUserSubject.next(profile);
          this.authStateSubject.next({ isAuthenticated: true, user: data.user });
        }
        this.loadingSubject.next(false);
        return { error: null, data: { user: profile, session: data.session } };
      }
      this.loadingSubject.next(false);
      return null;
    } catch (err) {
      this.loadingSubject.next(false);
      return { error: String(err), data: null };
    }
  }

  async signInWithGoogle(): Promise<{ error: string | null; data: any } | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return { error: 'Not in browser environment', data: null };
    }
    this.loadingSubject.next(true);
    try {
      const { data, error } = await this.supabaseService.client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      });

      if (error) {
        console.error('Error signing in with Google:', error);
        this.loadingSubject.next(false);
        return { error: error.message, data: null };
      }

      this.loadingSubject.next(false);
      return { error: null, data };
    } catch (err) {
      this.loadingSubject.next(false);
      return { error: String(err), data: null };
    }
  }

  async signOut(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      const { error } = await this.supabaseService.client.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
        return;
      }
      this.currentUserSubject.next(null);
      this.authStateSubject.next({ isAuthenticated: false });
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }

  async getSession(): Promise<any | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    try {
      const { data: { session } } = await this.supabaseService.client.auth.getSession();
      return session?.user || null;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  get currentUserId(): string | null {
    const user = this.currentUserSubject.value;
    return (user as any)?.id || null;
  }

  private reconstructUser(data: any): User {
    const userSettings = new settings();
    userSettings.recieve_notifications = data.settings?.receive_notifications ?? true;
    userSettings.allow_invite = data.settings?.allow_invite ?? true;
    userSettings.allow_google_calender = data.settings?.allow_google_calendar ?? true;

    const user = new User(data.username || data.email, userSettings);
    (user as any).id = data.id;

    if (data.contacts && Array.isArray(data.contacts)) {
      user.contacts = data.contacts.map((c: any) => new contact(c.name, c.contact_detail));
    }
    return user;
  }

  private async getOrCreateProfile(userId: string, email: string): Promise<User | null> {
    const existing = await this.loadUserProfile(userId);
    if (existing) {
      return existing;
    }

    const username = email.split('@')[0];
    const { error } = await this.supabaseService.client
      .from('profiles')
      .insert({
        id: userId,
        username: username,
        email: email,
        settings: {
          receive_notifications: true,
          allow_invite: true,
          allow_google_calendar: true
        }
      });

    if (error) {
      console.error('Error creating profile:', error);
      const userSettings = new settings();
      const user = new User(email, userSettings);
      (user as any).id = userId;
      return user;
    }

    return this.loadUserProfile(userId);
  }

  async updateProfile(updates: Partial<User>): Promise<void> {
    if (!this.currentUserId) {
      return;
    }

    const { error } = await this.supabaseService.client
      .from('profiles')
      .update({
        username: updates.name,
        settings: updates.settings
      })
      .eq('id', this.currentUserId);

    if (error) {
      console.error('Error updating profile:', error);
    }
  }

  async loadUserProfile(userId: string): Promise<User | null> {
    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error loading profile:', error);
      return null;
    }

    if (data) {
      return this.reconstructUser(data);
    }
    return null;
  }
}
