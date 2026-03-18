import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable } from 'rxjs';
import { User, settings, contact } from '../../../../shared_models/models/user.model';
import { Project, Grid } from '../../../../shared_models/models/project.model';
import { Screen_Element, objects_builder, ToDoLst } from '../../../../shared_models/models/screen-elements.model';
import { SupabaseService } from './supabase.service';
import { SupabaseAuthService } from './supabase-auth.service';

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {
  private isBrowser: boolean;
  private currentUserId: string | null = null;

  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$: Observable<boolean> = this.loadingSubject.asObservable();

  private savingSubject = new BehaviorSubject<boolean>(false);
  public saving$: Observable<boolean> = this.savingSubject.asObservable();

  constructor(
    private supabaseService: SupabaseService,
    private supabaseAuth: SupabaseAuthService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.loadCurrentUser();
      this.listenForAuthChanges();
    }
  }

  private async loadCurrentUser(): Promise<void> {
    const user = this.supabaseAuth.getCurrentUser();
    if (user) {
      this.currentUserId = (user as any).id;
    }
  }

  private listenForAuthChanges(): void {
    this.supabaseAuth.currentUser$.subscribe(user => {
      if (user) {
        this.currentUserId = (user as any).id;
      } else {
        this.currentUserId = null;
      }
    });
  }

  // ==================== User Operations ====================

  async loadUser(userId: string): Promise<User | null> {
    if (!this.isBrowser) {
      return null;
    }

    const { data, error } = await this.supabaseService.client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error loading user:', error);
      return null;
    }

    return this.reconstructUser(data);
  }

  async updateUserSettings(userId: string, userSettings: settings): Promise<boolean> {
    if (!this.isBrowser) {
      return false;
    }

    const { error } = await this.supabaseService.client
      .from('profiles')
      .update({ settings: userSettings })
      .eq('id', userId);

    if (error) {
      console.error('Error updating user settings:', error);
      return false;
    }
    return true;
  }

  // ==================== Contact Operations ====================

  async getContacts(userId: string): Promise<contact[]> {
    if (!this.isBrowser) {
      return [];
    }

    const { data, error } = await this.supabaseService.client
      .from('contacts')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      console.error('Error loading contacts:', error);
      return [];
    }
    return data?.map(c => new contact(c.name, c.contact_detail)) || [];
  }

  async addContact(userId: string, name: string, detail: string): Promise<boolean> {
    if (!this.isBrowser) {
      return false;
    }

    const { error } = await this.supabaseService.client
      .from('contacts')
      .insert({ user_id: userId, name, contact_detail: detail });

    if (error) {
      console.error('Error adding contact:', error);
      return false;
    }
    return true;
  }

  async deleteContact(userId: string, contactId: string): Promise<boolean> {
    if (!this.isBrowser) {
      return false;
    }

    const { error } = await this.supabaseService.client
      .from('contacts')
      .delete()
      .eq('id', contactId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting contact:', error);
      return false;
    }
    return true;
  }

  // ==================== Project Operations ====================

  async getProjects(userId: string, projectType?: 'local' | 'hosted'): Promise<Project[]> {
    if (!this.isBrowser) {
      return [];
    }

    let query = this.supabaseService.client
      .from('projects')
      .select('*')
      .eq('owner_id', userId);

    if (projectType) {
      query = query.eq('project_type', projectType);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error loading projects:', error);
      return [];
    }

    const projects: Project[] = [];
    for (const projectData of data || []) {
      const project = await this.reconstructProject(projectData);
      if (project) {
        projects.push(project);
      }
    }
    return projects;
  }

  async getProject(projectId: string): Promise<Project | null> {
    if (!this.isBrowser) {
      return null;
    }

    const { data, error } = await this.supabaseService.client
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (error) {
      console.error('Error loading project:', error);
      return null;
    }
    return this.reconstructProject(data);
  }

  async createProject(name: string, projectType: 'local' | 'hosted'): Promise<Project | null> {
    if (!this.isBrowser || !this.currentUserId) {
      return null;
    }

    this.savingSubject.next(true);
    const { data, error } = await this.supabaseService.client
      .from('projects')
      .insert({
        name,
        owner_id: this.currentUserId,
        project_type: projectType
      })
      .select('*')
      .single();

    if (error) {
      console.error('Error creating project:', error);
      this.savingSubject.next(false);
      return null;
    }

    const project = await this.reconstructProject(data);
    this.savingSubject.next(false);
    return project;
  }

  async updateProject(project: Project): Promise<boolean> {
    if (!this.isBrowser || !this.currentUserId) {
      return false;
    }

    this.savingSubject.next(true);

    const projectId = (project as any).id;
    const { error: projectError } = await this.supabaseService.client
      .from('projects')
      .update({ name: project.name, updated_at: new Date().toISOString() })
      .eq('id', projectId);

    if (projectError) {
      console.error('Error updating project:', projectError);
      this.savingSubject.next(false);
      return false;
    }

    // Sync grids
    for (const grid of project.grid) {
      await this.syncGrid(projectId, grid);
    }

    this.savingSubject.next(false);
    return true;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    if (!this.isBrowser) {
      return false;
    }

    const { error } = await this.supabaseService.client
      .from('projects')
      .delete()
      .eq('id', projectId);

    if (error) {
      console.error('Error deleting project:', error);
      return false;
    }
    return true;
  }

  // ==================== Grid Operations ====================

  async getGrids(projectId: string): Promise<Grid[]> {
    if (!this.isBrowser) {
      return [];
    }

    const { data, error } = await this.supabaseService.client
      .from('grids')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading grids:', error);
      return [];
    }

    const grids: Grid[] = [];
    for (const gridData of data || []) {
      const grid = await this.reconstructGrid(gridData);
      if (grid) {
        grids.push(grid);
      }
    }
    return grids;
  }

  async createGrid(projectId: string, name: string): Promise<Grid | null> {
    if (!this.isBrowser) {
      return null;
    }

    const { data, error } = await this.supabaseService.client
      .from('grids')
      .insert({ project_id: projectId, name })
      .select('*')
      .single();

    if (error) {
      console.error('Error creating grid:', error);
      return null;
    }
    return this.reconstructGrid(data);
  }

  async deleteGrid(gridId: string): Promise<boolean> {
    if (!this.isBrowser) {
      return false;
    }

    const { error } = await this.supabaseService.client
      .from('grids')
      .delete()
      .eq('id', gridId);

    if (error) {
      console.error('Error deleting grid:', error);
      return false;
    }
    return true;
  }

  private async syncGrid(projectId: string, grid: Grid): Promise<void> {
    const gridId = (grid as any).id;
    if (!gridId) {
      const newGrid = await this.createGrid(projectId, grid.name);
      if (newGrid) {
        (grid as any).id = (newGrid as any).id;
      }
      return;
    }

    await this.supabaseService.client
      .from('grids')
      .update({ name: grid.name })
      .eq('id', gridId);

    await this.syncElements(gridId, grid.Screen_elements);
  }

  private async syncElements(gridId: string, elements: Screen_Element[]): Promise<void> {
    const { data: existingElements } = await this.supabaseService.client
      .from('screen_elements')
      .select('id')
      .eq('grid_id', gridId);

    const existingIds = new Set(existingElements?.map((e: any) => e.id) || []);

    for (const element of elements) {
      const elementId = (element as any).id;
      const elementData = this.serializeElement(element);

      if (elementId && existingIds.has(elementId)) {
        await this.supabaseService.client
          .from('screen_elements')
          .update(elementData)
          .eq('id', elementId);
        existingIds.delete(elementId);
      } else {
        const { data } = await this.supabaseService.client
          .from('screen_elements')
          .insert({ ...elementData, grid_id: gridId })
          .select('id')
          .single();
        if (data) {
          (element as any).id = data.id;
        }
      }
    }

    for (const idToDelete of existingIds) {
      await this.supabaseService.client
        .from('screen_elements')
        .delete()
        .eq('id', idToDelete);
    }
  }

  // ==================== Task Operations ====================

  async getTasks(gridId: string): Promise<any[]> {
    if (!this.isBrowser) {
      return [];
    }

    const { data, error } = await this.supabaseService.client
      .from('tasks')
      .select('*')
      .eq('grid_id', gridId);

    if (error) {
      console.error('Error loading tasks:', error);
      return [];
    }
    return data || [];
  }

  async updateTask(taskId: string, updates: any): Promise<boolean> {
    if (!this.isBrowser) {
      return false;
    }

    const { error } = await this.supabaseService.client
      .from('tasks')
      .update(updates)
      .eq('id', taskId);

    if (error) {
      console.error('Error updating task:', error);
      return false;
    }
    return true;
  }

  // ==================== Helper Methods ====================

  private reconstructUser(data: any): User {
    const userSettings = new settings();
    if (data.settings) {
      userSettings.recieve_notifications = data.settings.receive_notifications ?? true;
      userSettings.allow_invite = data.settings.allow_invite ?? true;
      userSettings.allow_google_calender = data.settings.allow_google_calendar ?? true;
    }

    const user = new User(data.username || data.email, userSettings);
    (user as any).id = data.id;

    if (data.contacts && Array.isArray(data.contacts)) {
      user.contacts = data.contacts.map((c: any) => new contact(c.name, c.contact_detail));
    }
    return user;
  }

  private async reconstructProject(data: any): Promise<Project | null> {
    if (!data) return null;

    const project = new Project(data.name, data.owner_id, data.project_type);
    (project as any).id = data.id;
    (project as any).isLocal = data.project_type === 'local';

    const grids = await this.getGrids(data.id);
    project.grid = grids;

    return project;
  }

  private async reconstructGrid(data: any): Promise<Grid | null> {
    if (!data) return null;

    const grid = new Grid(data.name);
    (grid as any).id = data.id;

    // Load elements from screen_elements table
    const { data: elementsData } = await this.supabaseService.client
      .from('screen_elements')
      .select('*')
      .eq('grid_id', data.id);

    if (elementsData) {
      for (const elemData of elementsData) {
        const element = objects_builder.rebuild(elemData);
        if (element) {
          grid.Screen_elements.push(element as Screen_Element);
        }
      }
    }

    return grid;
  }

  private serializeElement(element: Screen_Element): any {
    const elem = element as any;
    const type = element.constructor.name;

    const serialized: any = {
      type,
      name: element.name,
      x_pos: element.x_pos,
      y_pos: element.y_pos,
      x_scale: element.x_scale,
      y_scale: element.y_scale
    };

    if (type === 'Text_document' || type === 'Text') {
      serialized.Text_field = elem.Text_field;
    } else if (type === 'Image') {
      serialized.imagepath = elem.imagepath;
    } else if (type === 'Video') {
      serialized.VideoPath = elem.VideoPath;
    } else if (type === 'ToDoLst') {
      serialized.scheduled_tasks = elem.scheduled_tasks?.map((t: any) => t.toJSON?.() || t);
    }

    return serialized;
  }
}
