import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable } from 'rxjs';
import { User, settings } from '../../../../shared_models/models/user.model';
import { Project } from '../../../../shared_models/models/project.model';
import { Screen_Element } from '../../../../shared_models/models/screen_elements.model';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private usersData: Map<number, User> = new Map();
  private currentUserId: number | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.loadInitialData();
  }

  private loadInitialData(): void {
    // Only access localStorage in browser environment
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Load from localStorage if available
    const savedData = localStorage.getItem('clarity_users');
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        // Reconstruct users from JSON
        // Note: This is a simplified version - you may need to properly deserialize
      } catch (e) {
        console.error('Error loading saved data:', e);
      }
    }
  }

  // User management
  findUserByName(name: string): User | null {
    for (const [userId, user] of this.usersData.entries()) {
      if (user.name === name) {
        return user;
      }
    }
    return null;
  }

  createUser(name: string): User {
    // Check if user already exists
    const existingUser = this.findUserByName(name);
    if (existingUser) {
      // User exists, log them in
      this.currentUserId = existingUser.user_id;
      this.currentUserSubject.next(existingUser);
      return existingUser;
    }

    // Create new user
    const userId = Date.now(); // Simple ID generation
    const userSettings = new settings();
    const user = new User(userId, name, userSettings);
    this.usersData.set(userId, user);
    this.currentUserId = userId;
    this.currentUserSubject.next(user);
    this.saveToStorage();
    return user;
  }

  loginUser(userId: number): boolean {
    const user = this.usersData.get(userId);
    if (user) {
      this.currentUserId = userId;
      this.currentUserSubject.next(user);
      return true;
    }
    return false;
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  // Project management
  createProject(projectName: string): Project | null {
    const user = this.getCurrentUser();
    if (user) {
      user.create_project(projectName);
      this.saveToStorage();
      this.currentUserSubject.next(user);
      return user.projects[user.projects.length - 1];
    }
    return null;
  }

  deleteProject(projectIndex: number): boolean {
    const user = this.getCurrentUser();
    if (user) {
      const result = user.delete_project(projectIndex);
      if (result) {
        this.saveToStorage();
        this.currentUserSubject.next(user);
      }
      return result;
    }
    return false;
  }

  // Grid management
  createGrid(projectIndex: number, gridName: string): boolean {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex]) {
      user.projects[projectIndex].create_grid(gridName);
      this.saveToStorage();
      this.currentUserSubject.next(user);
      return true;
    }
    return false;
  }

  deleteGrid(projectIndex: number, gridIndex: number): boolean {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex]) {
      const result = user.projects[projectIndex].remove_grid(gridIndex);
      if (result) {
        this.saveToStorage();
        this.currentUserSubject.next(user);
      }
      return result;
    }
    return false;
  }

  // Element management
  addElementToGrid(projectIndex: number, gridIndex: number, element: Screen_Element): boolean {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex] && user.projects[projectIndex].grid[gridIndex]) {
      user.projects[projectIndex].grid[gridIndex].add_element(element);
      this.saveToStorage();
      this.currentUserSubject.next(user);
      return true;
    }
    return false;
  }

  removeElementFromGrid(projectIndex: number, gridIndex: number, elementIndex: number): boolean {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex] && user.projects[projectIndex].grid[gridIndex]) {
      const result = user.projects[projectIndex].grid[gridIndex].remove_element(elementIndex);
      if (result) {
        this.saveToStorage();
        this.currentUserSubject.next(user);
      }
      return result;
    }
    return false;
  }

  // Settings management
  updateSettings(settings: settings): void {
    const user = this.getCurrentUser();
    if (user) {
      user.settings = settings;
      this.saveToStorage();
      this.currentUserSubject.next(user);
    }
  }

  // Save to localStorage
  private saveToStorage(): void {
    // Only access localStorage in browser environment
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const user = this.getCurrentUser();
    if (user && this.currentUserId) {
      // Convert to JSON (simplified - you may need proper serialization)
      const userData = {
        userId: user.user_id,
        name: user.name,
        projects: user.projects,
        settings: user.settings,
        contacts: user.contacts
      };
      this.usersData.set(this.currentUserId, user);
      localStorage.setItem('clarity_users', JSON.stringify(Array.from(this.usersData.entries())));
    }
  }

  // Update current user (for triggering change detection)
  updateCurrentUser(): void {
    const user = this.getCurrentUser();
    this.currentUserSubject.next(user);
  }

  // Logout
  logout(): void {
    this.currentUserId = null;
    this.currentUserSubject.next(null);
  }
}

