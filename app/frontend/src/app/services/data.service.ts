import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { User, settings } from '../../../../shared_models/models/user.model';
import { Project } from '../../../../shared_models/models/project.model';
import { Screen_Element } from '../../../../shared_models/models/screen-elements.model';
import { SocketService } from './socket.service';
import { UserStore } from './user-store.service';
import { ProjectRepository } from './project-repository.service';

/**
 * R13: `DataService` is now a thin facade over three focused collaborators —
 * {@link UserStore} (state + localStorage), {@link ProjectRepository} (socket
 * CRUD) and the ProjectSerializer they share. It keeps only the orchestration
 * that spans state + backend, and preserves the exact public API its ~11
 * consumers depend on. Phase 4: all data flows through the Socket.IO/Postgres
 * backend.
 */
@Injectable({
  providedIn: 'root'
})
export class DataService {
  constructor(
    private socketService: SocketService,
    private userStore: UserStore,
    private projectRepo: ProjectRepository
  ) {}

  // ── Streams (delegated) ────────────────────────────────────────────────
  get currentUser$(): Observable<User | null> { return this.userStore.currentUser$; }
  get savingProject$(): Observable<boolean> { return this.projectRepo.savingProject$; }
  get loadingProject$(): Observable<boolean> { return this.projectRepo.loadingProject$; }
  get deletingProject$(): Observable<boolean> { return this.projectRepo.deletingProject$; }
  get listingProjects$(): Observable<boolean> { return this.projectRepo.listingProjects$; }

  // ── User state ─────────────────────────────────────────────────────────
  findUserByName(name: string): User | null {
    return this.userStore.findUserByName(name);
  }

  getCurrentUser(): User | null {
    return this.userStore.getCurrentUser();
  }

  createUser(name: string): User {
    const existingUser = this.findUserByName(name);
    if (existingUser) {
      this.userStore.setActive(existingUser);
      return existingUser;
    }

    const user = new User(name, new settings());
    this.userStore.setActive(user);
    this.userStore.saveToStorage();
    this.saveUserToBackend(user);

    return user;
  }

  async createUserAsync(name: string): Promise<User> {
    const existingUser = this.findUserByName(name);
    if (existingUser) {
      this.userStore.setActive(existingUser);
      return existingUser;
    }

    const backendUser = await this.loadUserFromBackend(name);
    if (backendUser) {
      this.userStore.setActive(backendUser);
      this.userStore.saveToStorage();
      console.log(`[DataService] Loaded existing user "${name}" from backend`);
      return backendUser;
    }

    const user = new User(name, new settings());
    this.userStore.setActive(user);
    this.userStore.saveToStorage();

    await this.saveUserToBackend(user);
    console.log(`[DataService] Created new user "${name}" and saved to backend`);

    return user;
  }

  loginUser(userName: string): boolean {
    const user = this.userStore.findUserByName(userName);
    if (user) {
      this.userStore.setActive(user);
      this.socketService.identifyUser(userName);
      return true;
    }
    return false;
  }

  updateCurrentUser(): void {
    this.userStore.updateCurrentUser();
  }

  logout(): void {
    this.userStore.logout();
  }

  updateSettings(settings: settings): void {
    const user = this.getCurrentUser();
    if (user) {
      user.settings = settings;
      this.userStore.saveToStorage();
      this.saveUserToBackend(user);
      this.userStore.next(user);
    }
  }

  updateUsernameToEmail(email: string): User | null {
    const currentUser = this.getCurrentUser();
    if (!currentUser) {
      return this.createUser(email);
    }

    const oldName = currentUser.name;
    if (oldName === email) {
      console.log('[DataService] Username is already set to email:', email);
      return currentUser;
    }

    console.log(`[DataService] Updating username from "${oldName}" to "${email}"`);
    this.userStore.rename(currentUser, email);
    this.socketService.identifyUser(email);
    this.saveUserToBackend(currentUser);
    console.log('[DataService] Username updated successfully to:', email);
    return currentUser;
  }

  getUserContacts(): any[] {
    const user = this.getCurrentUser();
    return user?.contacts || [];
  }

  // ── User backend I/O (delegated) ───────────────────────────────────────
  async saveUserToBackend(user: User): Promise<boolean> {
    return this.projectRepo.saveUser(user);
  }

  async loadUserFromBackend(username: string): Promise<User | null> {
    return this.projectRepo.loadUser(username);
  }

  // ── Projects ───────────────────────────────────────────────────────────
  createProject(projectName: string, projectType: 'local' | 'hosted' = 'local'): Project | null {
    const user = this.getCurrentUser();
    if (user) {
      const project = new Project(projectName, user.name, projectType);
      // Start every project with a default canvas so it's never gridless —
      // elements can only be added to a grid, so a project with no grid is a
      // dead end where added elements are silently dropped.
      project.create_grid('Main Canvas');
      user.projects.push(project);
      this.userStore.next(user);
      return project;
    }
    return null;
  }

  async createProjectAsync(projectName: string, projectType: 'local' | 'hosted' = 'local'): Promise<Project | null> {
    const user = this.getCurrentUser();
    if (!user) {
      return null;
    }

    const project = new Project(projectName, user.name, projectType);
    // Match createProject: never leave a project gridless (see note above).
    project.create_grid('Main Canvas');
    user.projects.push(project);
    this.userStore.next(user);
    return project;
  }

  /**
   * A16: remove an optimistically-created project from the in-memory user
   * (no server call). Used to roll back a create that the server rejected — e.g.
   * a duplicate name — so the local list doesn't keep a project that was never
   * persisted.
   */
  removeLocalProject(project: Project): void {
    const user = this.getCurrentUser();
    if (!user) return;
    const index = user.projects.indexOf(project);
    if (index !== -1) {
      user.projects.splice(index, 1);
      this.userStore.next(user);
    }
  }

  async saveProject(project: Project, projectType: 'local' | 'hosted' = 'local', expectNew = false): Promise<boolean> {
    const finalProjectType = (project as any).projectType || projectType;
    console.log(`[DataService] saveProject called: project="${project.name}", projectType="${finalProjectType}"`);

    const success = await this.projectRepo.save(project, finalProjectType, expectNew);
    if (success) {
      const user = this.getCurrentUser();
      if (user) {
        const index = user.projects.findIndex(p => p.name === project.name);
        if (index === -1) {
          user.projects.push(project);
        } else {
          user.projects[index] = project;
        }
        this.userStore.next(user);
      }
    }
    return success;
  }

  async loadProject(projectName: string, projectType: 'local' | 'hosted' = 'local'): Promise<Project | null> {
    return this.projectRepo.load(projectName, projectType);
  }

  async listProjects(projectType: 'local' | 'hosted' = 'local'): Promise<Project[]> {
    return this.projectRepo.list(projectType);
  }

  async deleteProject(projectName: string, projectType: 'local' | 'hosted' = 'local'): Promise<boolean> {
    const success = await this.projectRepo.delete(projectName, projectType);
    if (success) {
      const user = this.getCurrentUser();
      if (user) {
        const index = user.projects.findIndex(p => p.name === projectName);
        if (index !== -1) {
          user.projects.splice(index, 1);
        }
      }
    }
    return success;
  }

  async deleteProjectByIndex(projectIndex: number): Promise<boolean> {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex]) {
      const project = user.projects[projectIndex];
      const projectType = (project as any).projectType || 'local';
      return this.deleteProject(project.name, projectType);
    }
    return false;
  }

  async loadUserProjects(): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) {
      console.error('[DataService] No user logged in');
      return;
    }

    console.log(`[DataService] Loading projects for user: ${user.name}`);

    const localProjects = await this.listProjects('local');
    const hostedProjects = await this.listProjects('hosted');
    user.projects = [...localProjects, ...hostedProjects];

    console.log(`[DataService] Loaded ${user.projects.length} projects for user ${user.name}`);
    this.userStore.next(user);
    this.userStore.saveToStorage();
  }

  // ── Grid / element mutations (state + persist) ─────────────────────────
  async createGrid(projectIndex: number, gridName: string): Promise<boolean> {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex]) {
      user.projects[projectIndex].create_grid(gridName);
      const project = user.projects[projectIndex];
      const projectType = (project as any).projectType || 'local';
      await this.saveProject(project, projectType);
      return true;
    }
    return false;
  }

  async deleteGrid(projectIndex: number, gridIndex: number): Promise<boolean> {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex]) {
      const result = user.projects[projectIndex].remove_grid(gridIndex);
      if (result) {
        const project = user.projects[projectIndex];
        const projectType = (project as any).projectType || 'local';
        await this.saveProject(project, projectType);
      }
      return result;
    }
    return false;
  }

  async addElementToGrid(projectIndex: number, gridIndex: number, element: Screen_Element): Promise<boolean> {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex] && user.projects[projectIndex].grid[gridIndex]) {
      user.projects[projectIndex].grid[gridIndex].add_element(element);
      const project = user.projects[projectIndex];
      const projectType = (project as any).projectType || 'local';
      await this.saveProject(project, projectType);
      return true;
    }
    return false;
  }

  async removeElementFromGrid(projectIndex: number, gridIndex: number, elementIndex: number): Promise<boolean> {
    const user = this.getCurrentUser();
    if (user && user.projects[projectIndex] && user.projects[projectIndex].grid[gridIndex]) {
      const grid = user.projects[projectIndex].grid[gridIndex];
      const project = user.projects[projectIndex];
      const projectType = (project as any).projectType || 'local';

      const elementToDelete = grid.Screen_elements[elementIndex];

      console.log(`[DataService] removeElementFromGrid: elementToDelete=`, elementToDelete);
      console.log(`[DataService] removeElementFromGrid: elementToDelete type=`, elementToDelete?.constructor?.name);

      if (elementToDelete) {
        const elementType = elementToDelete.constructor.name;
        if (elementType === 'Image' || elementType === 'Video') {
          const filePath = (elementToDelete as any).imagepath || (elementToDelete as any).VideoPath;
          if (filePath) {
            try {
              console.log(`[DataService] Attempting to delete file for ${elementType}:`, filePath);

              const urlMatch = filePath.match(/\/projects\/(local|hosted)\/(.+)$/);
              if (urlMatch) {
                const relativePath = urlMatch[2]; // e.g., "YOOO_assets/file.png"
                console.log(`[DataService] Extracted relative path: ${relativePath}`);

                const deleteResponse = await this.projectRepo.deleteFile(project.name, projectType, relativePath);

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
            }
          } else {
            console.warn(`[DataService] ⚠ No file path found for ${elementType} element`);
          }
        }
      }

      const result = grid.remove_element(elementIndex);
      if (result) {
        await this.saveProject(project, projectType);
      }
      return result;
    }
    return false;
  }

  // ── Contacts ───────────────────────────────────────────────────────────
  async importGoogleContacts(): Promise<{ success: boolean; message: string; newContacts?: number }> {
    const user = this.getCurrentUser();
    if (!user) {
      return { success: false, message: 'No user logged in' };
    }

    if (!user.settings?.allow_invite) {
      return {
        success: false,
        message: 'Contact import is disabled. Enable "Allow Invites" in settings first.'
      };
    }

    console.log(`[DataService] Importing Google Contacts for: ${user.name}`);

    try {
      const response = await this.projectRepo.importGoogleContacts(user.name);
      if (response.success) {
        console.log(`[DataService] ✓ Successfully imported contacts:`, response);

        const updatedUser = await this.loadUserFromBackend(user.name);
        if (updatedUser) {
          user.contacts = updatedUser.contacts || [];
          this.userStore.next(user);
          this.userStore.saveToStorage();
        }

        return {
          success: true,
          message: response.message,
          newContacts: response.newContacts
        };
      } else {
        console.error(`[DataService] Failed to import contacts:`, response.message);
        return { success: false, message: response.message };
      }
    } catch (error: any) {
      console.error('[DataService] Error importing contacts:', error);
      return { success: false, message: `Error: ${error.message}` };
    }
  }
}
