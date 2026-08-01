import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { User } from '../../../../shared_models/models/user.model';
import { ProjectSerializer } from './project-serializer.service';

/**
 * R13: the user-state + localStorage half of the former `DataService`
 * god-service. Owns the current-user stream, the in-memory user map and all
 * browser-storage persistence. Knows nothing about sockets or serialization
 * wire-formats (it defers reconstruction to {@link ProjectSerializer}).
 */
@Injectable({ providedIn: 'root' })
export class UserStore {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private usersData: Map<string, User> = new Map();
  private currentUserName: string | null = null;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private serializer: ProjectSerializer
  ) {
    this.loadInitialData();
  }

  private loadInitialData(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const saved = localStorage.getItem('clarity_users');
    const currentName = localStorage.getItem('current_user_name');
    console.log('Loaded from storage:', saved, currentName);

    if (saved && currentName) {
      try {
        const users = JSON.parse(saved);
        const userEntry = users.find((u: any[]) => u[0] === String(currentName));
        if (userEntry) {
          const userData = userEntry[1];
          console.log('Restoring user:', userData);

          const user = this.serializer.reconstructUser(userData);

          this.currentUserName = user.name;
          this.usersData.set(user.name, user);
          this.currentUserSubject.next(user);
        }
      } catch (e) {
        console.error('Error parsing user data:', e);
      }
    }
  }

  findUserByName(name: string): User | null {
    for (const [userId, user] of this.usersData.entries()) {
      if (user.name === name) {
        if (user.settings && typeof user.settings.toggle_notif !== 'function') {
          const reconstructed = this.serializer.reconstructUser(user);
          this.usersData.set(userId, reconstructed);
          return reconstructed;
        }
        return user;
      }
    }
    return null;
  }

  getCurrentUser(): User | null {
    const user = this.currentUserSubject.value;
    if (user && user.settings && typeof user.settings.toggle_notif !== 'function') {
      const reconstructed = this.serializer.reconstructUser(user);
      this.usersData.set(user.name, reconstructed);
      this.currentUserSubject.next(reconstructed);
      return reconstructed;
    }
    return user;
  }

  /** Push a (possibly mutated) user object onto the stream. */
  next(user: User | null): void {
    this.currentUserSubject.next(user);
  }

  /** Register a user, make it current, and persist the active-user pointer. */
  setActive(user: User): void {
    this.usersData.set(user.name, user);
    this.currentUserName = user.name;
    this.currentUserSubject.next(user);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('current_user_name', user.name);
    }
  }

  /** Re-key the current user under a new name (used by the email-rename flow). */
  rename(user: User, newName: string): void {
    const oldName = user.name;
    user.name = newName;
    this.usersData.delete(oldName);
    this.usersData.set(newName, user);
    this.currentUserName = newName;
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('current_user_name', newName);
      localStorage.setItem('clarity_users', JSON.stringify(Array.from(this.usersData.entries())));
    }
    this.currentUserSubject.next(user);
  }

  saveToStorage(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const user = this.getCurrentUser();
    if (user && this.currentUserName) {
      this.usersData.set(this.currentUserName, user);
      localStorage.setItem('clarity_users', JSON.stringify(Array.from(this.usersData.entries())));
    }
  }

  updateCurrentUser(): void {
    const user = this.getCurrentUser();
    this.currentUserSubject.next(user);
  }

  logout(): void {
    this.currentUserName = null;
    this.currentUserSubject.next(null);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('current_user_name');
    }
  }
}
