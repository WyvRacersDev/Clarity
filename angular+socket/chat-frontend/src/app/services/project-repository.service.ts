import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { User } from '../../../../shared_models/models/user.model';
import { Project } from '../../../../shared_models/models/project.model';
import { SocketService } from './socket.service';
import { ProjectSerializer } from './project-serializer.service';

/**
 * R13: the socket-CRUD half of the former `DataService` god-service. Owns every
 * round-trip to the Socket.IO/Postgres backend for projects, users and assets,
 * plus the in-flight status streams the UI binds to. Returns domain objects
 * (deserialized via {@link ProjectSerializer}); holds no user state.
 */
@Injectable({ providedIn: 'root' })
export class ProjectRepository {
  private savingProjectSubject = new BehaviorSubject<boolean>(false);
  public savingProject$ = this.savingProjectSubject.asObservable();

  private loadingProjectSubject = new BehaviorSubject<boolean>(false);
  public loadingProject$ = this.loadingProjectSubject.asObservable();

  private deletingProjectSubject = new BehaviorSubject<boolean>(false);
  public deletingProject$ = this.deletingProjectSubject.asObservable();

  private listingProjectsSubject = new BehaviorSubject<boolean>(false);
  public listingProjects$ = this.listingProjectsSubject.asObservable();

  constructor(
    private socketService: SocketService,
    private serializer: ProjectSerializer
  ) {}

  async save(project: Project, projectType: 'local' | 'hosted', expectNew = false): Promise<boolean> {
    this.savingProjectSubject.next(true);
    try {
      const serializedProject = this.serializer.serializeProjectForSaving(project);
      serializedProject.project_type = projectType;
      // A16: forward the CREATE intent so the server rejects (rather than silently
      // overwrites) a duplicate. Edits leave `expectNew` false and keep upserting.
      const response = await firstValueFrom(
        this.socketService.saveProject(serializedProject, projectType, expectNew)
      );

      console.log(`[ProjectRepository] Save response received for project "${project.name}":`, response);

      if (response && response.success) {
        this.savingProjectSubject.next(false);
        return true;
      }
      console.error('Failed to save project:', response?.message || 'Unknown error');
      this.savingProjectSubject.next(false);
      return false;
    } catch (error) {
      console.error('Error saving project:', error);
      this.savingProjectSubject.next(false);
      return false;
    }
  }

  async load(projectName: string, projectType: 'local' | 'hosted'): Promise<Project | null> {
    this.loadingProjectSubject.next(true);
    try {
      const response = await firstValueFrom(
        this.socketService.loadProject(projectName, projectType)
      );

      if (response.success && response.project) {
        const project = this.serializer.deserializeProject(response.project);
        (project as any).projectType = projectType;
        (project as any).isLocal = projectType === 'local';
        // N1: carry the server-resolved access info so the UI can gate the Share
        // dialog + editing (server still enforces; this is UX only).
        (project as any).role = response.project.role ?? null;
        (project as any).isOwner = response.project.isOwner ?? false;
        (project as any).canEdit = response.project.canEdit ?? true;
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

  async list(projectType: 'local' | 'hosted'): Promise<Project[]> {
    this.listingProjectsSubject.next(true);
    try {
      const response = await firstValueFrom(
        this.socketService.listProjects(projectType)
      );

      if (response && response.success && response.projects) {
        const projectInfos = response.projects;
        console.log(`[ProjectRepository] ${projectType} projects to load:`, projectInfos.map((p: any) => ({ name: p.name, filename: p.filename })));

        const loadPromises = projectInfos.map(async (projectInfo: any) => {
          try {
            console.log(`[ProjectRepository] Loading ${projectType} project: "${projectInfo.name}"`);
            const loadResponse = await firstValueFrom(
              this.socketService.loadProject(projectInfo.name, projectType)
            );

            if (loadResponse && loadResponse.success && loadResponse.project) {
              const project = this.serializer.deserializeProject(loadResponse.project);
              (project as any).projectType = projectType;
              (project as any).isLocal = projectType === 'local';
              // N1: carry access info so the Share button / read-only state work
              // even when the project is opened straight from the list.
              (project as any).role = loadResponse.project.role ?? null;
              (project as any).isOwner = loadResponse.project.isOwner ?? false;
              (project as any).canEdit = loadResponse.project.canEdit ?? true;
              return project;
            } else {
              console.warn(`[ProjectRepository] Failed to load ${projectType} project "${projectInfo.name}":`, loadResponse?.message);
            }
            return null;
          } catch (error) {
            console.error(`[ProjectRepository] Error loading ${projectType} project ${projectInfo.name}:`, error);
            return null;
          }
        });

        const loadedProjects = await Promise.all(loadPromises);
        const validProjects = loadedProjects.filter(p => p !== null) as Project[];
        console.log(`[ProjectRepository] Returning ${validProjects.length} ${projectType} projects:`, validProjects.map(p => p.name));

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

  async delete(projectName: string, projectType: 'local' | 'hosted'): Promise<boolean> {
    this.deletingProjectSubject.next(true);
    try {
      const response = await firstValueFrom(
        this.socketService.deleteProject(projectName, projectType)
      );

      if (response.success) {
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

  async deleteFile(projectName: string, projectType: 'local' | 'hosted', relativePath: string): Promise<any> {
    return firstValueFrom(
      this.socketService.deleteFile(projectName, projectType, relativePath)
    );
  }

  async saveUser(user: User): Promise<boolean> {
    try {
      console.log(`[ProjectRepository] Saving user "${user.name}" to backend...`);

      const serializedUser = this.serializer.serializeUserForSaving(user);

      const response = await firstValueFrom(
        this.socketService.saveUser(serializedUser)
      );

      if (response && response.success) {
        console.log(`[ProjectRepository] ✓ User "${user.name}" saved to backend successfully`);
        return true;
      }

      console.error(`[ProjectRepository] Failed to save user to backend:`, response?.message);
      return false;
    } catch (error) {
      console.error('[ProjectRepository] Error saving user to backend:', error);
      return false;
    }
  }

  async loadUser(username: string): Promise<User | null> {
    try {
      console.log(`[ProjectRepository] Loading user "${username}" from backend...`);

      const response = await firstValueFrom(
        this.socketService.loadUser(username)
      );

      if (response && response.success && response.user) {
        console.log(`[ProjectRepository] ✓ User "${username}" loaded from backend`);
        return this.serializer.deserializeUser(response.user);
      }

      console.log(`[ProjectRepository] User "${username}" not found on backend`);
      return null;
    } catch (error) {
      console.error('[ProjectRepository] Error loading user from backend:', error);
      return null;
    }
  }

  async importGoogleContacts(username: string): Promise<any> {
    return firstValueFrom(
      this.socketService.importGoogleContacts(username)
    );
  }
}
