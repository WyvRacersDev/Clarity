import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { DataService } from './data.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { User } from '../../../../shared_models/models/user.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$: Observable<boolean> = this.loadingSubject.asObservable();

  private errorSubject = new BehaviorSubject<string | null>(null);
  public error$: Observable<string | null> = this.errorSubject.asObservable();

  private useSupabase = true; // Flag to switch between Supabase and legacy auth

  constructor(
    private dataService: DataService,
    private supabaseAuth: SupabaseAuthService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    if (isPlatformBrowser(this.platformId)) {
      this.loadCurrentUser();
    }
  }

  private async loadCurrentUser(): Promise<void> {
    if (this.useSupabase) {
      const user = this.supabaseAuth.getCurrentUser();
      if (user) {
        this.currentUserSubject.next(user);
      }
    } else {
      const user = this.dataService.getCurrentUser();
      if (user) {
        this.currentUserSubject.next(user);
      }
    }
  }

  // Legacy login (username only)
  login(userName: string): boolean {
    if (!this.useSupabase) {
      const success = this.dataService.loginUser(userName);
      if (success) {
        this.currentUserSubject.next(this.dataService.getCurrentUser());
      }
      return success;
    }
    return false;
  }

  // Supabase login with email/password
  async loginWithEmail(email: string, password: string): Promise<boolean> {
    this.loadingSubject.next(true);
    this.errorSubject.next(null);

    try {
      const result = await this.supabaseAuth.signIn(email, password);
      if (result && result.error) {
        this.errorSubject.next(result.error);
        this.loadingSubject.next(false);
        return false;
      }
      if (result && result.data) {
        this.currentUserSubject.next(result.data.user);
        this.loadingSubject.next(false);
        return true;
      }
      this.loadingSubject.next(false);
      return false;
    } catch (error) {
      this.errorSubject.next(String(error));
      this.loadingSubject.next(false);
      return false;
    }
  }

  // Legacy register
  register(name: string, password: string): User {
    if (!this.useSupabase) {
      const user = this.dataService.createUser(name);
      this.login(user.name);
      this.currentUserSubject.next(user);
      return user;
    }
    throw new Error('Use registerWithEmail for Supabase auth');
  }

  // Supabase register with email/password
  async registerWithEmail(email: string, password: string, username?: string): Promise<User | null> {
    this.loadingSubject.next(true);
    this.errorSubject.next(null);

    try {
      const result = await this.supabaseAuth.signUp(email, password);
      if (result && result.error) {
        this.errorSubject.next(result.error);
        this.loadingSubject.next(false);
        return null;
      }
      if (result && result.data && result.data.user) {
        this.currentUserSubject.next(result.data.user);
        this.loadingSubject.next(false);
        return result.data.user;
      }
      this.loadingSubject.next(false);
      return null;
    } catch (error) {
      this.errorSubject.next(String(error));
      this.loadingSubject.next(false);
      return null;
    }
  }

  // Google OAuth
  async loginWithGoogle(): Promise<boolean> {
    this.loadingSubject.next(true);
    this.errorSubject.next(null);

    try {
      const result = await this.supabaseAuth.signInWithGoogle();
      if (result && result.error) {
        this.errorSubject.next(result.error);
        this.loadingSubject.next(false);
        return false;
      }
      // OAuth redirects, so we don't get the user immediately
      // The auth state will be updated after the callback
      return true;
    } catch (error) {
      this.errorSubject.next(String(error));
      this.loadingSubject.next(false);
      return false;
    }
  }

  async logout(): Promise<void> {
    if (this.useSupabase) {
      await this.supabaseAuth.signOut();
    } else {
      this.dataService.logout();
    }
    this.currentUserSubject.next(null);
    this.router.navigate(['/']);
  }

  isLoggedIn(): boolean {
    if (this.useSupabase) {
      const user = this.supabaseAuth.getCurrentUser();
      return !!user;
    }
    const user = this.dataService.getCurrentUser();
    return !!user;
  }

  getCurrentUser(): User | null {
    if (this.useSupabase) {
      return this.supabaseAuth.getCurrentUser();
    }
    return this.dataService.getCurrentUser();
  }

  getLoading(): boolean {
    return this.loadingSubject.value;
  }

  getError(): string | null {
    return this.errorSubject.value;
  }

  clearError(): void {
    this.errorSubject.next(null);
  }

  // Switch between Supabase and legacy auth (for migration purposes)
  setAuthMode(useSupabase: boolean): void {
    this.useSupabase = useSupabase;
  }
}
