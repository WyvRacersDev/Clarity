import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { Screen_Element } from '../../../../shared_models/models/screen_elements.model';
import { getServerConfig } from '../config/app.config';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket | null = null;
  private readonly isBrowser: boolean;
  private serverUrl: string;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);

    // Get server URL (will be evaluated in browser context)
    this.serverUrl = this.isBrowser ? getServerConfig() : 'http://localhost:3000';

    // Only initialize socket in browser environment (not during SSR)
    if (this.isBrowser) {
      this.socket = io(this.serverUrl);
      this.setupConnection();
    }
  }

  /**
   * Check if socket is available (browser environment)
   */
  private isSocketAvailable(): boolean {
    return this.isBrowser && this.socket !== null;
  }

  private setupConnection(): void {
    if (!this.isSocketAvailable()) return;

    this.socket!.on('connect', () => {
      console.log('Connected to server:', this.socket!.id);
      // Identify user when connected
      const currentUser = this.getCurrentUser();
      if (currentUser) {
        this.identifyUser(currentUser);
      }
    });

    this.socket!.on('disconnect', () => {
      console.log('Disconnected from server');
    });
  }

  /**
   * Identify the current user to the server
   */
  identifyUser(username: string): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('identifyUser', { username });
    console.log(`[SocketService] Identified user: ${username}`);
  }

  /**
   * Get current user from localStorage (helper method)
   * Safe for SSR - checks if localStorage is available
   */
  private getCurrentUser(): string | null {
    try {
      // Check if we're in a browser environment (localStorage is not available in SSR)
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return null;
      }
      const currentUserName = localStorage.getItem('current_user_name');
      return currentUserName;
    } catch (error) {
      console.error('Error getting current user:', error);
    }
    return null;
  }

  // Emit screen element updates
  emitElementUpdate(element: Screen_Element, projectId: string, gridId: string): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('elementUpdate', {
      element: element.toJSON(),
      projectId,
      gridId
    });
  }

  // Listen for element updates
  onElementUpdate(): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.complete();
        return;
      }
      this.socket!.on('elementUpdate', (data) => {
        observer.next(data);
      });
    });
  }

  // Join a project room for collaboration
  joinProject(projectId: string, userId: number): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('joinProject', { projectId, userId });
  }

  // Leave a project room
  leaveProject(projectId: string): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('leaveProject', { projectId });
  }

  // Listen for user activity in project
  onUserActivity(): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.complete();
        return;
      }
      this.socket!.on('userActivity', (data) => {
        observer.next(data);
      });
    });
  }

  // Emit task updates
  emitTaskUpdate(task: any, projectId: string): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.emit('taskUpdate', { task, projectId });
  }

  // Listen for task updates
  onTaskUpdate(): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.complete();
        return;
      }
      this.socket!.on('taskUpdate', (data) => {
        observer.next(data);
      });
    });
  }

  // Disconnect socket
  disconnect(): void {
    if (!this.isSocketAvailable()) return;
    this.socket!.disconnect();
  }

  // Get socket instance
  getSocket(): Socket | null {
    return this.isSocketAvailable() ? this.socket : null;
  }

  // === Project Management Methods ===

  /**
   * Save a project to the server
   * @param project The project object to save
   * @param projectType 'local' or 'hosted'
   * @returns Observable that emits the save result
   */
  saveProject(project: any, projectType: 'local' | 'hosted'): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('Save project timeout'));
        observer.complete();
      }, 10000); // 10 second timeout

      this.socket!.emit('saveProject', { project, projectType });

      this.socket!.once('projectSaved', (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });
    });
  }

  /**
   * Load a project from the server
   * @param projectName Name of the project to load
   * @param projectType 'local' or 'hosted'
   * @returns Observable that emits the loaded project
   */
  loadProject(projectName: string, projectType: 'local' | 'hosted'): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('Load project timeout'));
        observer.complete();
      }, 10000);

      // Use a unique event name per project to avoid mix-ups when loading in parallel
      // Create a safe event name from project name and type
      const safeName = projectName.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
      const eventName = `projectLoaded_${projectType}_${safeName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const handler = (response: any) => {
        // Verify this is the correct project
        if (response && response.success && response.project && response.project.name === projectName) {
          clearTimeout(timeout);
          this.socket!.off(eventName, handler);
          observer.next(response);
          observer.complete();
        }
      };

      this.socket!.on(eventName, handler);
      this.socket!.emit('loadProject', { projectName, projectType, eventName });
    });
  }

  /**
   * List all projects of a specific type
   * @param projectType 'local' or 'hosted'
   * @returns Observable that emits the list of projects
   */
  listProjects(projectType: 'local' | 'hosted'): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('List projects timeout'));
        observer.complete();
      }, 10000); // 10 second timeout

      // Use a unique event name per project type to avoid mix-ups when loading in parallel
      const eventName = `projectsListed_${projectType}`;

      this.socket!.once(eventName, (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });

      this.socket!.emit('listProjects', { projectType });
    });
  }

  /**
   * Delete a project from the server
   * @param projectName Name of the project to delete
   * @param projectType 'local' or 'hosted'
   * @returns Observable that emits the delete result
   */
  deleteProject(projectName: string, projectType: 'local' | 'hosted'): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      this.socket!.emit('deleteProject', { projectName, projectType });

      this.socket!.once('projectDeleted', (response: any) => {
        observer.next(response);
        observer.complete();
      });
    });
  }
  // === User Management Methods ===

  /**
   * Save a user to the server
   * @param user The user object to save
   * @returns Observable that emits the save result
   */
  saveUser(user: any): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('Save user timeout'));
        observer.complete();
      }, 10000); // 10 second timeout

      this.socket!.emit('saveUser', { user });

      this.socket!.once('userSaved', (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });
    });
  }

  /**
   * Load a user from the server
   * @param username Username to load
   * @returns Observable that emits the loaded user
   */
  loadUser(username: string): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('Load user timeout'));
        observer.complete();
      }, 10000);

      const eventName = `userLoaded_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      this.socket!.once(eventName, (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });

      this.socket!.emit('loadUser', { username, eventName });
    });
  }

  /**
   * List all users
   * @returns Observable that emits the list of users
   */
  listUsers(): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('List users timeout'));
        observer.complete();
      }, 10000);

      this.socket!.once('usersListed', (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });

      this.socket!.emit('listUsers', {});
    });
  }
  /**
   * Delete a user from the server
   * @param username Username to delete
   * @returns Observable that emits the delete result
   */
  deleteUser(username: string): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      this.socket!.emit('deleteUser', { username });

      this.socket!.once('userDeleted', (response: any) => {
        observer.next(response);
        observer.complete();
      });
    });
  }
  /**
  * Check if a user exists on the server
  * @param username Username to check
  * @returns Observable that emits whether the user exists
  */
  checkUserExists(username: string): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('Check user exists timeout'));
        observer.complete();
      }, 10000);

      this.socket!.once('userExistsResult', (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });

      this.socket!.emit('checkUserExists', { username });
    });
  }
  /**
   * Upload a file (image or video) for a project
   * @param projectName Name of the project
   * @param projectType 'local' or 'hosted'
   * @param fileName Original file name
   * @param fileData Base64 data URL of the file
   * @param fileType 'image' or 'video'
   * @returns Observable that emits the upload result with the local file path
   */
  uploadFile(projectName: string, projectType: 'local' | 'hosted', fileName: string, fileData: string, fileType: 'image' | 'video'): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('File upload timeout'));
        observer.complete();
      }, 60000); // 60 second timeout for large files

      const eventName = `fileUploaded_${projectName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      this.socket!.once(eventName, (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });

      this.socket!.emit('uploadFile', {
        projectName,
        projectType,
        fileName,
        fileData,
        fileType,
        eventName
      });
    });
  }

  /**
   * Delete a file (image or video) for a project
   * @param projectName Name of the project
   * @param projectType 'local' or 'hosted'
   * @param filePath Relative path to the file (e.g., "projectname_assets/file.png")
   * @returns Observable that emits the delete result
   */
  deleteFile(projectName: string, projectType: 'local' | 'hosted', filePath: string): Observable<any> {
    // Delete file from server filesystem
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }

      const timeout = setTimeout(() => {
        observer.error(new Error('File delete timeout'));
        observer.complete();
      }, 10000); // 10 second timeout

      const eventName = `fileDeleted_${projectName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      this.socket!.once(eventName, (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });

      this.socket!.emit('deleteFile', {
        projectName,
        projectType,
        filePath,
        eventName
      });
    });
  }

  /**
   * Listen for hosted project updates (broadcasted to all clients)
   * @returns Observable that emits when a hosted project is updated
   */
  onHostedProjectUpdated(): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        console.warn('[SocketService] Socket not available for hostedProjectUpdated listener');
        observer.complete();
        return;
      }

      console.log('[SocketService] Setting up hostedProjectUpdated listener');
      const handler = (data: any) => {
        console.log('[SocketService] ✓ Received hostedProjectUpdated event:', data);
        observer.next(data);
      };

      this.socket!.on('hostedProjectUpdated', handler);
      console.log('[SocketService] ✓ hostedProjectUpdated listener registered');

      // Return cleanup function
      return () => {
        if (this.isSocketAvailable()) {
          console.log('[SocketService] Cleaning up hostedProjectUpdated listener');
          this.socket!.off('hostedProjectUpdated', handler);
        }
      };
    });
  }

  /**
   * Listen for hosted project deletions (broadcasted to all clients)
   * @returns Observable that emits when a hosted project is deleted
   */
  onHostedProjectDeleted(): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        console.warn('[SocketService] Socket not available for hostedProjectDeleted listener');
        observer.complete();
        return;
      }

      console.log('[SocketService] Setting up hostedProjectDeleted listener');
      const handler = (data: any) => {
        console.log('[SocketService] ✓ Received hostedProjectDeleted event:', data);
        observer.next(data);
      };

      this.socket!.on('hostedProjectDeleted', handler);
      console.log('[SocketService] ✓ hostedProjectDeleted listener registered');

      // Return cleanup function
      return () => {
        if (this.isSocketAvailable()) {
          console.log('[SocketService] Cleaning up hostedProjectDeleted listener');
          this.socket!.off('hostedProjectDeleted', handler);
        }
      };
    });
  }
   /**
   * Import Google Contacts for a user
   * @param username Username to import contacts for
   * @returns Observable that emits the import result
   */
  importGoogleContacts(username: string): Observable<any> {
    return new Observable(observer => {
      if (!this.isSocketAvailable()) {
        observer.error(new Error('Socket not available (SSR)'));
        observer.complete();
        return;
      }
      
      console.log('[SocketService] Importing Google Contacts for:', username);
      
      const timeout = setTimeout(() => {
        console.error('[SocketService] Import contacts timeout');
        observer.error(new Error('Import contacts timeout'));
        observer.complete();
      }, 30000); // 30 second timeout for contact import
      
      this.socket!.once('contactsImported', (response: any) => {
        console.log('[SocketService] Received contactsImported response:', response);
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });
         
      this.socket!.emit('importGoogleContacts', { username });
      console.log('[SocketService] Emitted importGoogleContacts event');
    });
  }
}




