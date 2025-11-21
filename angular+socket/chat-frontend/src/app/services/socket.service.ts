import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { Screen_Element } from '../../../../shared_models/models/screen_elements.model';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket;
  private readonly serverUrl = 'http://localhost:3000';

  constructor() {
    this.socket = io(this.serverUrl);
    this.setupConnection();
  }

  private setupConnection(): void {
    this.socket.on('connect', () => {
      console.log('Connected to server:', this.socket.id);
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });
  }

  // Emit screen element updates
  emitElementUpdate(element: Screen_Element, projectId: string, gridId: string): void {
    this.socket.emit('elementUpdate', {
      element: element.toJSON(),
      projectId,
      gridId
    });
  }

  // Listen for element updates
  onElementUpdate(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('elementUpdate', (data) => {
        observer.next(data);
      });
    });
  }

  // Join a project room for collaboration
  joinProject(projectId: string, userId: number): void {
    this.socket.emit('joinProject', { projectId, userId });
  }

  // Leave a project room
  leaveProject(projectId: string): void {
    this.socket.emit('leaveProject', { projectId });
  }

  // Listen for user activity in project
  onUserActivity(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('userActivity', (data) => {
        observer.next(data);
      });
    });
  }

  // Emit task updates
  emitTaskUpdate(task: any, projectId: string): void {
    this.socket.emit('taskUpdate', { task, projectId });
  }

  // Listen for task updates
  onTaskUpdate(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('taskUpdate', (data) => {
        observer.next(data);
      });
    });
  }

  // Disconnect socket
  disconnect(): void {
    this.socket.disconnect();
  }

  // Get socket instance
  getSocket(): Socket {
    return this.socket;
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
      const timeout = setTimeout(() => {
        observer.error(new Error('Save project timeout'));
        observer.complete();
      }, 10000); // 10 second timeout
      
      this.socket.emit('saveProject', { project, projectType });
      
      this.socket.once('projectSaved', (response: any) => {
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
      this.socket.emit('loadProject', { projectName, projectType });
      
      this.socket.once('projectLoaded', (response: any) => {
        observer.next(response);
        observer.complete();
      });
    });
  }

  /**
   * List all projects of a specific type
   * @param projectType 'local' or 'hosted'
   * @returns Observable that emits the list of projects
   */
  listProjects(projectType: 'local' | 'hosted'): Observable<any> {
    return new Observable(observer => {
      const timeout = setTimeout(() => {
        observer.error(new Error('List projects timeout'));
        observer.complete();
      }, 10000); // 10 second timeout
      
      this.socket.emit('listProjects', { projectType });
      
      this.socket.once('projectsListed', (response: any) => {
        clearTimeout(timeout);
        observer.next(response);
        observer.complete();
      });
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
      this.socket.emit('deleteProject', { projectName, projectType });
      
      this.socket.once('projectDeleted', (response: any) => {
        observer.next(response);
        observer.complete();
      });
    });
  }
}


