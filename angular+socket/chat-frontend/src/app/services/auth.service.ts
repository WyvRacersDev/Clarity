import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { DataService } from './data.service';
import { SocketService } from './socket.service';
import { getServerConfig } from '../config/server.config';
import { User, settings } from '../../../../shared_models/models/user.model';

/**
 * Phase 4: Auth is now fully backed by the Postgres/JWT backend.
 *  - registerWithEmail  -> POST /auth/register  { email, username, password } -> { token, user }
 *  - loginWithEmail     -> POST /auth/login     { identifier, password }      -> { token, user }
 *  - loginWithGoogle    -> window.location = <backend>/auth/google (redirect)
 *
 * The returned JWT is stored in localStorage under `auth_token` (the SAME key the
 * socket handshake reads). After storing/removing the token the socket is
 * reconnected so the new identity is sent in the handshake.
 */
const AUTH_TOKEN_KEY = 'auth_token';

interface AuthResponse {
  token: string;
  user: { id: string; username: string; email: string };
}

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

  constructor(
    private dataService: DataService,
    private socketService: SocketService,
    private http: HttpClient,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    if (isPlatformBrowser(this.platformId)) {
      this.loadCurrentUser();
    }
  }

  private get baseUrl(): string {
    return getServerConfig();
  }

  private loadCurrentUser(): void {
    // If we still hold a JWT, fully restore identity FROM THE TOKEN. Decoding the
    // JWT (rather than reading DataService's in-memory cache, which is empty on a
    // fresh page load) is what keeps the canonical `username` identity — and thus
    // project owner filtering / access checks — working across refreshes. The
    // socket is already re-created with this token by SocketService's constructor.
    const token = this.getToken();
    if (!token) return;
    const claims = this.decodeJwt(token);
    if (claims && (claims['username'] || claims['email'])) {
      this.adoptBackendUser({
        id: String(claims['sub'] ?? ''),
        username: String(claims['username'] ?? ''),
        email: String(claims['email'] ?? ''),
      }).catch(() => {
        const user = this.dataService.getCurrentUser();
        if (user) this.currentUserSubject.next(user);
      });
    } else {
      const user = this.dataService.getCurrentUser();
      if (user) this.currentUserSubject.next(user);
    }
  }

  private getToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private storeToken(token: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } catch (e) {
      console.error('[AuthService] Failed to store auth token:', e);
    }
    // Reconnect the socket so the handshake carries the new JWT.
    this.socketService.reconnect();
  }

  private clearToken(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch {
      // ignore
    }
    this.socketService.reconnect();
  }

  /**
   * Turn the backend's `{ id, username, email }` into a domain User and register
   * it with DataService so the rest of the app (projects, contacts, socket
   * identity) resolves the same identity string the backend uses.
   */
  private async adoptBackendUser(backendUser: { id: string; username: string; email: string }): Promise<User> {
    // The canonical identity MUST be the JWT `username`, because that is exactly
    // what the backend compares against: project `owner_name` is derived from
    // `users.username`, and the gateways filter/authorize with
    // `identity().username` (the JWT username). Adopting `email` here would store
    // e.g. "demo@clarity.local" as `current_user_name`, which never matches the
    // owner_name "demo" — so the projects list comes back empty and local
    // projects fail the owner check. Fall back to email only if username is
    // somehow absent.
    const identity = backendUser.username || backendUser.email;
    // Load (or create) the corresponding user record via the backend socket path.
    const user = await this.dataService.createUserAsync(identity);
    (user as any).id = backendUser.id;
    this.currentUserSubject.next(user);
    return user;
  }

  // Legacy username-only login retained for the demo entry point.
  login(userName: string): boolean {
    const success = this.dataService.loginUser(userName);
    if (success) {
      this.currentUserSubject.next(this.dataService.getCurrentUser());
    }
    return success;
  }

  // Email/password login via the backend.
  async loginWithEmail(email: string, password: string): Promise<boolean> {
    this.loadingSubject.next(true);
    this.errorSubject.next(null);

    try {
      const res = await firstValueFrom(
        this.http.post<AuthResponse>(`${this.baseUrl}/auth/login`, {
          identifier: email,
          password
        })
      );

      if (res && res.token) {
        this.storeToken(res.token);
        await this.adoptBackendUser(res.user);
        this.loadingSubject.next(false);
        return true;
      }
      this.errorSubject.next('Login failed');
      this.loadingSubject.next(false);
      return false;
    } catch (error: any) {
      this.errorSubject.next(this.extractError(error, 'Invalid email or password'));
      this.loadingSubject.next(false);
      return false;
    }
  }

  // Legacy register retained for the demo entry point.
  register(name: string, password: string): User {
    const user = this.dataService.createUser(name);
    this.login(user.name);
    this.currentUserSubject.next(user);
    return user;
  }

  // Email/password registration via the backend.
  async registerWithEmail(email: string, password: string, username?: string): Promise<User | null> {
    this.loadingSubject.next(true);
    this.errorSubject.next(null);

    try {
      const res = await firstValueFrom(
        this.http.post<AuthResponse>(`${this.baseUrl}/auth/register`, {
          email,
          username: username || email.split('@')[0],
          password
        })
      );

      if (res && res.token) {
        this.storeToken(res.token);
        const user = await this.adoptBackendUser(res.user);
        this.loadingSubject.next(false);
        return user;
      }
      this.errorSubject.next('Registration failed');
      this.loadingSubject.next(false);
      return null;
    } catch (error: any) {
      this.errorSubject.next(this.extractError(error, 'Registration failed'));
      this.loadingSubject.next(false);
      return null;
    }
  }

  // Google OAuth: kick off the backend redirect flow. The backend lands back on
  // FRONTEND_URL/auth/callback?token=... which AuthCallbackComponent handles.
  async loginWithGoogle(): Promise<boolean> {
    this.errorSubject.next(null);
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }
    this.loadingSubject.next(true);
    window.location.href = `${this.baseUrl}/auth/google`;
    return true;
  }

  /**
   * Complete a Google login after the backend redirects back with `?token=`.
   * Stores the JWT, decodes the identity from it, adopts the user, and resolves.
   */
  async completeTokenLogin(token: string): Promise<boolean> {
    this.storeToken(token);
    const claims = this.decodeJwt(token);
    if (!claims) {
      return false;
    }
    await this.adoptBackendUser({
      id: String(claims['sub'] ?? ''),
      username: String(claims['username'] ?? ''),
      email: String(claims['email'] ?? '')
    });
    return true;
  }

  async logout(): Promise<void> {
    this.clearToken();
    this.dataService.logout();
    this.currentUserSubject.next(null);
    this.router.navigate(['/']);
  }

  isLoggedIn(): boolean {
    if (this.getToken()) {
      return true;
    }
    // Demo/legacy path: rely on DataService's current user.
    return !!this.dataService.getCurrentUser();
  }

  getCurrentUser(): User | null {
    const user = this.currentUserSubject.value;
    if (user) return user;
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

  // Retained for API compatibility; auth is always backend-backed now.
  setAuthMode(_legacyFlag: boolean): void {
    // no-op: authentication is always handled by the Postgres backend
  }

  private extractError(error: any, fallback: string): string {
    if (error?.error?.error) return error.error.error;
    if (error?.error?.message) return error.error.message;
    if (error?.message) return error.message;
    return fallback;
  }

  private decodeJwt(token: string): Record<string, any> | null {
    try {
      const payload = token.split('.')[1];
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json);
    } catch (e) {
      console.error('[AuthService] Failed to decode JWT:', e);
      return null;
    }
  }
}
