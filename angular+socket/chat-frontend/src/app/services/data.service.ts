import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { User, settings } from '../../../../shared_models/models/user.model';
import { Project, Grid } from '../../../../shared_models/models/project.model';
import { Screen_Element, objects_builder } from '../../../../shared_models/models/screen_elements.model';
import { SocketService } from './socket.service';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private usersData: Map<number, User> = new Map();
  private currentUserId: number | null = null;

  // Loading states
  private savingProjectSubject = new BehaviorSubject<boolean>(false);
  public savingProject$ = this.savingProjectSubject.asObservable();

  private loadingProjectSubject = new BehaviorSubject<boolean>(false);
  public loadingProject$ = this.loadingProjectSubject.asObservable();

  private deletingProjectSubject = new BehaviorSubject<boolean>(false);
  public deletingProject$ = this.deletingProjectSubject.asObservable();

  private listingProjectsSubject = new BehaviorSubject<boolean>(false);
  public listingProjects$ = this.listingProjectsSubject.asObservable();

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private socketService: SocketService
    
  ) {
    this.loadInitialData();
  }

  private loadInitialData(): void {
    // Only access localStorage in browser environment
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

   if (!isPlatformBrowser(this.platformId)) return;

  const saved = localStorage.getItem("clarity_users");
  const currentId = localStorage.getItem("current_user_id");
  console.log("Loaded from storage:", saved, currentId);
  if (saved && currentId) {
    try {
      const users = JSON.parse(saved);
      const userEntry = users.find((u: any[]) => u[0] === Number(currentId));

      if (userEntry) {
        const user = userEntry[1];
        console.log("Restoring user:", user);
        this.currentUserSubject.next(user);   // <-- IMPORTANT
      }
    } catch (e) {
      console.error("Error parsing user data:", e);
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

          // 🔥 Persist login across reloads
    localStorage.setItem("current_user_id", userId.toString());
      return true;
    }
    return false;
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  // Project management
  /**
   * Create a new project (in memory only, call saveProject to persist)
   */
  createProject(projectName: string, projectType: 'local' | 'hosted' = 'local'): Project | null {
    const user = this.getCurrentUser();
    if (user) {
      const project = new Project(projectName);
      (project as any).projectType = projectType;
      (project as any).isLocal = projectType === 'local';
      user.projects.push(project);
      this.currentUserSubject.next(user);
      return project;
    }
    return null;
  }

  /**
   * Save a project to the server
   */
  async saveProject(project: Project, projectType: 'local' | 'hosted' = 'local'): Promise<boolean> {
    console.log('saveProject called, setting saving to true');
    this.savingProjectSubject.next(true);
    try {
      const response = await firstValueFrom(
        this.socketService.saveProject(project, projectType)
      );
      
      console.log('Save response received:', response);
      
      if (response && response.success) {
        // Update user's project list if needed
        const user = this.getCurrentUser();
        if (user) {
          const index = user.projects.findIndex(p => p.name === project.name);
          if (index === -1) {
            user.projects.push(project);
          } else {
            user.projects[index] = project;
          }
          // Emit updated user to trigger component reloads
          this.currentUserSubject.next(user);
        }
        console.log('Save successful, setting saving to false');
        this.savingProjectSubject.next(false);
        return true;
      }
      console.error('Failed to save project:', response?.message || 'Unknown error');
      this.savingProjectSubject.next(false);
      return false;
    } catch (error) {
      console.error('Error saving project:', error);
      // Always clear saving state, even on error
      this.savingProjectSubject.next(false);
      return false;
    }
  }

  /**
   * Load a project from the server
   */
  async loadProject(projectName: string, projectType: 'local' | 'hosted' = 'local'): Promise<Project | null> {
    this.loadingProjectSubject.next(true);
    try {
      const response = await firstValueFrom(
        this.socketService.loadProject(projectName, projectType)
      );
      
      if (response.success && response.project) {
        const project = this.deserializeProject(response.project);
        // Ensure projectType is set correctly
        (project as any).projectType = projectType;
        (project as any).isLocal = projectType === 'local';
        this.loadingProjectSubject.next(false);
        return project;
      }
      console.error('Failed to load project:', response.message);
      this.loadingProjectSubject.next(false);
      return null;
    } catch (error) {
      console.error('Error loading project:', error);
      this.loadingProjectSubject.next(false);
      return null;
    }
  }

  /**
   * List all projects from the server - SIMPLE: just load from the correct directory
   */
  async listProjects(projectType: 'local' | 'hosted' = 'local'): Promise<Project[]> {
    this.listingProjectsSubject.next(true);
    try {
      const response = await firstValueFrom(
        this.socketService.listProjects(projectType)
      );
      
      if (response && response.success && response.projects) {
        const projectInfos = response.projects;
        console.log(`[DataService] ${projectType} projects to load:`, projectInfos.map((p: any) => ({ name: p.name, filename: p.filename })));
        
        // Load all projects in parallel
        const loadPromises = projectInfos.map(async (projectInfo: any) => {
          try {
            console.log(`[DataService] Loading ${projectType} project: "${projectInfo.name}"`);
            const loadResponse = await firstValueFrom(
              this.socketService.loadProject(projectInfo.name, projectType)
            );
            
            if (loadResponse && loadResponse.success && loadResponse.project) {
              console.log(`[DataService] Received project from server:`, loadResponse.project);
              const project = this.deserializeProject(loadResponse.project);
              console.log(`[DataService] After deserialize, project name: "${project.name}", type: ${projectType}`);
              // Set projectType based on which directory it came from
              (project as any).projectType = projectType;
              (project as any).isLocal = projectType === 'local';
              console.log(`[DataService] Final project: name="${project.name}", projectType="${(project as any).projectType}"`);
              return project;
            } else {
              console.warn(`[DataService] Failed to load ${projectType} project "${projectInfo.name}":`, loadResponse?.message);
            }
            return null;
          } catch (error) {
            console.error(`[DataService] Error loading ${projectType} project ${projectInfo.name}:`, error);
            return null;
          }
        });
        
        const loadedProjects = await Promise.all(loadPromises);
        const validProjects = loadedProjects.filter(p => p !== null) as Project[];
        console.log(`[DataService] Returning ${validProjects.length} ${projectType} projects:`, validProjects.map(p => p.name));
        
        this.listingProjectsSubject.next(false);
        return validProjects;
      }
      
      this.listingProjectsSubject.next(false);
      return [];
    } catch (error) {
      console.error(`Error listing ${projectType} projects:`, error);
      this.listingProjectsSubject.next(false);
      return [];
    }
  }

  /**
   * Delete a project from the server
   */
  async deleteProject(projectName: string, projectType: 'local' | 'hosted' = 'local'): Promise<boolean> {
    this.deletingProjectSubject.next(true);
    try {
      const response = await firstValueFrom(
        this.socketService.deleteProject(projectName, projectType)
      );
      
      if (response.success) {
        // Remove from user's project list (but don't trigger observable to avoid loops)
        const user = this.getCurrentUser();
        if (user) {
          const index = user.projects.findIndex(p => p.name === projectName);
          if (index !== -1) {
            user.projects.splice(index, 1);
            // Don't emit - let component handle its own updates
          }
        }
        this.deletingProjectSubject.next(false);
        return true;
      }
      console.error('Failed to delete project:', response.message);
      this.deletingProjectSubject.next(false);
      return false;
    } catch (error) {
      console.error('Error deleting project:', error);
      this.deletingProjectSubject.next(false);
      return false;
    }
  }

  /**
   * Delete project by index (for backward compatibility)
   */
  async deleteProjectByIndex(projectIndex: number): Promise<boolean> {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex]) {
      const project = user.projects[projectIndex];
      const projectType = (project as any).projectType || 'local';
      const result = await this.deleteProject(project.name, projectType);
      return result;
    }
    return false;
  }

  /**
   * Deserialize a project from JSON data
   */
  private deserializeProject(data: any): Project {
    console.log(`[DataService] deserializeProject called with data.name="${data.name}", data.projectType="${data.projectType}"`);
    const project = new Project(data.name);
    console.log(`[DataService] Created project with name="${project.name}"`);
    (project as any).projectType = data.projectType || 'local';
    (project as any).isLocal = data.projectType !== 'hosted';
    
    if (data.grid && Array.isArray(data.grid)) {
      data.grid.forEach((gridData: any) => {
        const grid = new Grid(gridData.name);
        if (gridData.Screen_elements && Array.isArray(gridData.Screen_elements)) {
          gridData.Screen_elements.forEach((elementData: any) => {
            const element = objects_builder.rebuild(elementData);
            if (element) {
              grid.add_element(element as any);
            }
          });
        }
        project.grid.push(grid);
      });
    }
    
    return project;
  }

  // Grid management
  /**
   * Create a grid in a project (updates in memory, call saveProject to persist)
   */
  async createGrid(projectIndex: number, gridName: string): Promise<boolean> {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex]) {
      user.projects[projectIndex].create_grid(gridName);
      // Auto-save the project (don't trigger observable to avoid loops)
      const project = user.projects[projectIndex];
      const projectType = (project as any).projectType || 'local';
      await this.saveProject(project, projectType);
      return true;
    }
    return false;
  }

  /**
   * Delete a grid from a project (updates in memory, call saveProject to persist)
   */
  async deleteGrid(projectIndex: number, gridIndex: number): Promise<boolean> {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex]) {
      const result = user.projects[projectIndex].remove_grid(gridIndex);
      if (result) {
        // Auto-save the project (don't trigger observable to avoid loops)
        const project = user.projects[projectIndex];
        const projectType = (project as any).projectType || 'local';
        await this.saveProject(project, projectType);
      }
      return result;
    }
    return false;
  }

  // Element management
  /**
   * Add an element to a grid (updates in memory, call saveProject to persist)
   */
  async addElementToGrid(projectIndex: number, gridIndex: number, element: Screen_Element): Promise<boolean> {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex] && user.projects[projectIndex].grid[gridIndex]) {
      user.projects[projectIndex].grid[gridIndex].add_element(element);
      // Auto-save the project (don't trigger observable to avoid loops)
      const project = user.projects[projectIndex];
      const projectType = (project as any).projectType || 'local';
      await this.saveProject(project, projectType);
      return true;
    }
    return false;
  }

  /**
   * Remove an element from a grid (updates in memory, call saveProject to persist)
   */
  async removeElementFromGrid(projectIndex: number, gridIndex: number, elementIndex: number): Promise<boolean> {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex] && user.projects[projectIndex].grid[gridIndex]) {
      const result = user.projects[projectIndex].grid[gridIndex].remove_element(elementIndex);
      if (result) {
        // Auto-save the project (don't trigger observable to avoid loops)
        const project = user.projects[projectIndex];
        const projectType = (project as any).projectType || 'local';
        await this.saveProject(project, projectType);
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
      // Save user data to localStorage (but not projects - those are on server)
      this.saveUserDataToStorage();
      this.currentUserSubject.next(user);
    }
  }

  // Save user data to localStorage (excluding projects - they're on server)
  private saveUserDataToStorage(): void {
    // Only access localStorage in browser environment
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const user = this.getCurrentUser();
    if (user && this.currentUserId) {
      // Save user data but not full project data (just project names/types for reference)
      const userData = {
        userId: user.user_id,
        name: user.name,
        settings: user.settings,
        contacts: user.contacts,
        projectReferences: user.projects.map(p => ({
          name: p.name,
          projectType: (p as any).projectType || 'local',
          gridCount: p.grid.length
        }))
      };
      this.usersData.set(this.currentUserId, user);
      localStorage.setItem('clarity_users', JSON.stringify(Array.from(this.usersData.entries())));
    }
  }

  // Legacy method for backward compatibility (now just saves user data)
  private saveToStorage(): void {
    this.saveUserDataToStorage();
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
      // 🔥 Clear login persistence
  localStorage.removeItem("current_user_id");
  }
}

