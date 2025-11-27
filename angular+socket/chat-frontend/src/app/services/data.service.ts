import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { User, settings } from '../../../../shared_models/models/user.model';
import { Project, Grid } from '../../../../shared_models/models/project.model';
import { Screen_Element, objects_builder } from '../../../../shared_models/models/screen_elements.model';
import { SocketService } from './socket.service';
import { getServerConfig } from '../config/app.config';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private usersData: Map<string, User> = new Map();
  private currentUserName: string | null = null;

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
  const currentName = localStorage.getItem("current_user_id");
  console.log("Loaded from storage:", saved, currentName);
  if (saved && currentName) {
    try {
      const users = JSON.parse(saved);
      const userEntry = users.find((u: any[]) => u[0] === String(currentName));

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
      this.currentUserSubject.next(existingUser);
      return existingUser;
    }

    // Create new user
    //const userId = Date.now(); // Simple ID generation
    //const userName="l230757@lhr.nu.edu.pk"
    const userSettings = new settings();
    const user = new User( name, userSettings);
    this.usersData.set(user.name, user);
    this.currentUserSubject.next(user);
    this.saveToStorage();
    return user;
  }

  loginUser(userName: string): boolean {
    const user = this.usersData.get(userName);
    if (user) {
      this.currentUserName = userName;
      this.currentUserSubject.next(user);
      // Identify user to server
      this.socketService.identifyUser(userName);

          // 🔥 Persist login across reloads
    localStorage.setItem("current_user_name", userName);
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
      const project = new Project(projectName,user.name,projectType);
//      (project as any).isLocal = projectType === 'local';
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
    // Ensure projectType is set correctly - use from project if available, otherwise use parameter
    const finalProjectType = (project as any).projectType || projectType;
    console.log(`[DataService] saveProject called: project="${project.name}", projectType="${finalProjectType}"`);
    this.savingProjectSubject.next(true);
    try {
      // Ensure all elements are properly serialized before sending
      // This ensures toJSON() is called on all elements
      const serializedProject = this.serializeProjectForSaving(project);
      // Make sure projectType is included in serialized project
      serializedProject.project_type = finalProjectType;
      const response = await firstValueFrom(
        this.socketService.saveProject(serializedProject, finalProjectType)
      );
      
      console.log(`[DataService] Save response received for project "${project.name}":`, response);
      
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
   * Serialize a project for saving (ensures toJSON() is called on all elements)
   */
  private serializeProjectForSaving(project: Project): any {
    return {
      owner_name: project.owner_name,
      name: project.name,
      project_type: (project as any).projectType || project.project_type || 'local',
      grid: project.grid.map((grid: Grid) => ({
        name: grid.name,
        Screen_elements: grid.Screen_elements.map((element: Screen_Element) => {
          const elem = element as any;
          console.log(`[DataService] Serializing element:`, {
            name: elem.name,
            type: elem.type || elem.constructor?.name,
            hasToJSON: typeof elem.toJSON === 'function',
            imagepath: elem.imagepath,
            VideoPath: elem.VideoPath,
            allKeys: Object.keys(elem)
          });
          
          // Call toJSON() if available, otherwise serialize manually
          if (element && typeof elem.toJSON === 'function') {
            const serialized = elem.toJSON();
            console.log(`[DataService] Serialized element via toJSON():`, serialized);
            return serialized;
          }
          
          // Fallback: serialize manually - detect type by properties
          let elementType = elem.constructor?.name || elem.type || 'Screen_Element';
          
          // Detect Image/Video by properties if type is wrong
          if (elementType === 'Object' || elementType === 'Screen_Element') {
            if (elem.imagepath !== undefined || elem.imagePath !== undefined || elem.ImageBase64 !== undefined) {
              elementType = 'Image';
            } else if (elem.VideoPath !== undefined || elem.videoPath !== undefined || elem.videoBase64 !== undefined) {
              elementType = 'Video';
            } else if (elem.Text_field !== undefined || elem.text_field !== undefined) {
              elementType = 'Text_document';
            } else if (elem.scheduled_tasks !== undefined && Array.isArray(elem.scheduled_tasks)) {
              elementType = 'ToDoLst';
            }
          }
          
          const serialized: any = {
            type: elementType,
            name: element.name,
            x_pos: element.x_pos,
            y_pos: element.y_pos,
            x_scale: element.x_scale,
            y_scale: element.y_scale
          };
          
          // Add type-specific properties - check all possible property names
          if (elem.Text_field !== undefined || elem.text_field !== undefined) {
            serialized.Text_field = elem.Text_field || elem.text_field;
          }
          if (elem.imagepath !== undefined || elem.imagePath !== undefined) {
            serialized.imagepath = elem.imagepath || elem.imagePath;
            console.log(`[DataService] Found imagepath: ${serialized.imagepath}`);
          }
          if (elem.VideoPath !== undefined || elem.videoPath !== undefined) {
            serialized.VideoPath = elem.VideoPath || elem.videoPath;
            console.log(`[DataService] Found VideoPath: ${serialized.VideoPath}`);
          }
          if (elem.scheduled_tasks !== undefined) {
            serialized.scheduled_tasks = elem.scheduled_tasks.map((t: any) => 
              (t && typeof t.toJSON === 'function') ? t.toJSON() : t
            );
          }
          
          console.log(`[DataService] Serialized element manually:`, serialized);
          return serialized;
        })
      }))
    };
  }

  /**
   * Convert localhost URLs to server URL for images/videos
   */
  private convertLocalhostUrls(element: Screen_Element): void {
    if (!isPlatformBrowser(this.platformId)) return;
    
    const serverUrl = getServerConfig();
    const elem = element as any;
    
    // Convert image paths
    if (elem.imagepath && typeof elem.imagepath === 'string') {
      if (elem.imagepath.startsWith('http://localhost:') || elem.imagepath.startsWith('https://localhost:')) {
        // Extract the path part after /projects
        const pathMatch = elem.imagepath.match(/\/projects\/(.+)$/);
        if (pathMatch) {
          elem.imagepath = `${serverUrl}/projects/${pathMatch[1]}`;
          console.log(`[DataService] Converted image URL from localhost to: ${elem.imagepath}`);
        }
      }
    }
    
    // Convert video paths
    if (elem.VideoPath && typeof elem.VideoPath === 'string') {
      if (elem.VideoPath.startsWith('http://localhost:') || elem.VideoPath.startsWith('https://localhost:')) {
        // Extract the path part after /projects
        const pathMatch = elem.VideoPath.match(/\/projects\/(.+)$/);
        if (pathMatch) {
          elem.VideoPath = `${serverUrl}/projects/${pathMatch[1]}`;
          console.log(`[DataService] Converted video URL from localhost to: ${elem.VideoPath}`);
        }
      }
    }
  }

  /**
   * Deserialize a project from JSON data
   */
  private deserializeProject(data: any): Project {
    console.log(`[DataService] deserializeProject called with data.name="${data.name}", data.projectType="${data.projectType}"`);
    const project = new Project(data.name,data.owner_name,data.projectType);
    console.log(`[DataService] Created project with name="${project.name}"`);
   // (project as any).projectType = data.projectType || 'local';
    (project as any).isLocal = data.projectType !== 'hosted';
    
    if (data.grid && Array.isArray(data.grid)) {
      data.grid.forEach((gridData: any) => {
        const grid = new Grid(gridData.name);
        if (gridData.Screen_elements && Array.isArray(gridData.Screen_elements)) {
          gridData.Screen_elements.forEach((elementData: any) => {
            const element = objects_builder.rebuild(elementData);
            if (element) {
              // Convert localhost URLs to server URL
              this.convertLocalhostUrls(element);
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
      const grid = user.projects[projectIndex].grid[gridIndex];
      const project = user.projects[projectIndex];
      const projectType = (project as any).projectType || 'local';
      
      // Get element BEFORE removing from grid
      const elementToDelete = grid.Screen_elements[elementIndex];
      
      console.log(`[DataService] removeElementFromGrid: elementToDelete=`, elementToDelete);
      console.log(`[DataService] removeElementFromGrid: elementToDelete type=`, elementToDelete?.constructor?.name);
      
      // If it's an Image or Video, delete the file first
      if (elementToDelete) {
        const elementType = elementToDelete.constructor.name;
        if (elementType === 'Image' || elementType === 'Video') {
          const filePath = (elementToDelete as any).imagepath || (elementToDelete as any).VideoPath;
          if (filePath) {
            try {
              console.log(`[DataService] Attempting to delete file for ${elementType}:`, filePath);
              
              // Extract the relative path from the full URL
              // URL format: http://localhost:3000/projects/{type}/{projectName}_assets/{filename}
              const urlMatch = filePath.match(/\/projects\/(local|hosted)\/(.+)$/);
              if (urlMatch) {
                const relativePath = urlMatch[2]; // e.g., "YOOO_assets/file.png"
                console.log(`[DataService] Extracted relative path: ${relativePath}`);
                
                const deleteResponse = await firstValueFrom(
                  this.socketService.deleteFile(project.name, projectType, relativePath)
                );
                
                if (deleteResponse.success) {
                  console.log(`[DataService] ✓ Successfully deleted file: ${relativePath}`);
                } else {
                  console.warn(`[DataService] ⚠ File deletion reported failure:`, deleteResponse.message);
                }
              } else {
                console.warn(`[DataService] ⚠ Could not parse file path from URL: ${filePath}`);
              }
            } catch (error) {
              console.error('[DataService] ✗ Error deleting file:', error);
              // Continue with element deletion even if file deletion fails
            }
          } else {
            console.warn(`[DataService] ⚠ No file path found for ${elementType} element`);
          }
        }
      }
      
      // Remove element from grid
      const result = grid.remove_element(elementIndex);
      if (result) {
        // Auto-save the project (don't trigger observable to avoid loops)
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
    if (user && this.currentUserName) {
      // Save user data but not full project data (just project names/types for reference)
      const userData = {
        name: user.name,
        settings: user.settings,
        contacts: user.contacts,
        projectReferences: user.projects.map(p => ({
          name: p.name,
          projectType: (p as any).projectType || 'local',
          gridCount: p.grid.length
        }))
      };
      this.usersData.set(this.currentUserName, user);
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
    this.currentUserName = null;
    this.currentUserSubject.next(null);
      // 🔥 Clear login persistence
  localStorage.removeItem("current_user_name");
  }
}

