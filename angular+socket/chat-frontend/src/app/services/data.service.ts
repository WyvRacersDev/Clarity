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
    
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const saved = localStorage.getItem("clarity_users");
       const currentName = localStorage.getItem("current_user_name");
    console.log("Loaded from storage:", saved, currentName);

    if (saved && currentName) {
      try {
        const users = JSON.parse(saved);
          const userEntry = users.find((u: any[]) => u[0] === String(currentName));
        if (userEntry) {
 const userData = userEntry[1];
          console.log("Restoring user:", userData);
          
          const user = this.reconstructUser(userData);
          
          this.currentUserName = user.name;
          this.usersData.set(user.name, user);
          this.currentUserSubject.next(user);
        }
      } catch (e) {
        console.error("Error parsing user data:", e);
      }
    }
  }

  private reconstructUser(userData: any): User {
      const userSettings = new settings();
    if (userData.settings) {
      userSettings.recieve_notifications = userData.settings.recieve_notifications !== undefined 
        ? userData.settings.recieve_notifications : true;
      userSettings.allow_invite = userData.settings.allow_invite !== undefined 
        ? userData.settings.allow_invite : true;
      userSettings.allow_google_calender = userData.settings.allow_google_calender !== undefined 
        ? userData.settings.allow_google_calender : true;
    }
    
     const user = new User(userData.name, userSettings);
    
      if (userData.projects && Array.isArray(userData.projects)) {
      user.projects = userData.projects;
    }
      
     if (userData.contacts && Array.isArray(userData.contacts)) {
      user.contacts = userData.contacts;
    }
    
    return user;
  }


   findUserByName(name: string): User | null {
    for (const [userId, user] of this.usersData.entries()) {
      if (user.name === name) {
          if (user.settings && typeof user.settings.toggle_notif !== 'function') {
            const reconstructed = this.reconstructUser(user);
          this.usersData.set(userId, reconstructed);
          return reconstructed;
        }
        return user;
      }
    }
    return null;
  }

  createUser(name: string): User {
     const existingUser = this.findUserByName(name);
    if (existingUser) {
         this.currentUserName = existingUser.name;
      this.currentUserSubject.next(existingUser);
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem("current_user_name", existingUser.name);
      }
      return existingUser;
    }

   
    const userSettings = new settings();
    const user = new User(name, userSettings);
    this.usersData.set(user.name, user);
    this.currentUserName = user.name;
    this.currentUserSubject.next(user);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem("current_user_name", user.name);
    }
    this.saveToStorage();
     
     this.saveUserToBackend(user);
    
    return user;
  }

  async createUserAsync(name: string): Promise<User> {
    const existingUser = this.findUserByName(name);
    if (existingUser) {
      this.currentUserName = existingUser.name;
      this.currentUserSubject.next(existingUser);
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem("current_user_name", existingUser.name);
      }
      return existingUser;
    }
    
    const backendUser = await this.loadUserFromBackend(name);
    if (backendUser) {
      this.usersData.set(backendUser.name, backendUser);
      this.currentUserName = backendUser.name;
      this.currentUserSubject.next(backendUser);
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem("current_user_name", backendUser.name);
      }
      this.saveToStorage();
      console.log(`[DataService] Loaded existing user "${name}" from backend`);
      return backendUser;
    }

    const userSettings = new settings();
    const user = new User(name, userSettings);
    this.usersData.set(user.name, user);
    this.currentUserName = user.name;
    this.currentUserSubject.next(user);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem("current_user_name", user.name);
    }
    this.saveToStorage();
      
    await this.saveUserToBackend(user);
    console.log(`[DataService] Created new user "${name}" and saved to backend`);
    
    return user;
  }

  loginUser(userName: string): boolean {
    const user = this.usersData.get(userName);
    if (user) {
      this.currentUserName = userName;
      this.currentUserSubject.next(user);
    
      this.socketService.identifyUser(userName);


      localStorage.setItem("current_user_name", userName);
      return true;
    }
    return false;
  }

  getCurrentUser(): User | null {
const user = this.currentUserSubject.value;
    if (user && user.settings && typeof user.settings.toggle_notif !== 'function') {
       const reconstructed = this.reconstructUser(user);
      this.usersData.set(user.name, reconstructed);
      this.currentUserSubject.next(reconstructed);
      return reconstructed;
    }
    return user;
  }

 
  createProject(projectName: string, projectType: 'local' | 'hosted' = 'local'): Project | null {
    const user = this.getCurrentUser();
    if (user) {
      const project = new Project(projectName, user.name, projectType);
          user.projects.push(project);
      this.currentUserSubject.next(user);
      return project;
    }
    return null;
  }

 
  async saveProject(project: Project, projectType: 'local' | 'hosted' = 'local'): Promise<boolean> {
       const finalProjectType = (project as any).projectType || projectType;
    console.log(`[DataService] saveProject called: project="${project.name}", projectType="${finalProjectType}"`);
    this.savingProjectSubject.next(true);
    try {

      const serializedProject = this.serializeProjectForSaving(project);
            serializedProject.project_type = finalProjectType;
      const response = await firstValueFrom(
        this.socketService.saveProject(serializedProject, finalProjectType)
      );

      console.log(`[DataService] Save response received for project "${project.name}":`, response);

      if (response && response.success) {
  
        const user = this.getCurrentUser();
        if (user) {
          const index = user.projects.findIndex(p => p.name === project.name);
          if (index === -1) {
            user.projects.push(project);
          } else {
            user.projects[index] = project;
          }
         
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
      
      this.savingProjectSubject.next(false);
      return false;
    }
  }

  async loadProject(projectName: string, projectType: 'local' | 'hosted' = 'local'): Promise<Project | null> {
    this.loadingProjectSubject.next(true);
    try {
      const response = await firstValueFrom(
        this.socketService.loadProject(projectName, projectType)
      );

      if (response.success && response.project) {
        const project = this.deserializeProject(response.project);
       
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


  async listProjects(projectType: 'local' | 'hosted' = 'local'): Promise<Project[]> {
    this.listingProjectsSubject.next(true);
    try {
      const response = await firstValueFrom(
        this.socketService.listProjects(projectType)
      );

      if (response && response.success && response.projects) {
        const projectInfos = response.projects;
        console.log(`[DataService] ${projectType} projects to load:`, projectInfos.map((p: any) => ({ name: p.name, filename: p.filename })));

       
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


  async deleteProject(projectName: string, projectType: 'local' | 'hosted' = 'local'): Promise<boolean> {
    this.deletingProjectSubject.next(true);
    try {
      const response = await firstValueFrom(
        this.socketService.deleteProject(projectName, projectType)
      );

      if (response.success) {
         const user = this.getCurrentUser();
        if (user) {
          const index = user.projects.findIndex(p => p.name === projectName);
          if (index !== -1) {
            user.projects.splice(index, 1);
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

              if (element && typeof elem.toJSON === 'function') {
            const serialized = elem.toJSON();
            console.log(`[DataService] Serialized element via toJSON():`, serialized);
            return serialized;
          }

              let elementType = elem.constructor?.name || elem.type || 'Screen_Element';

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


  private convertLocalhostUrls(element: Screen_Element): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const serverUrl = getServerConfig();
    const elem = element as any;

       if (elem.imagepath && typeof elem.imagepath === 'string') {
      if (elem.imagepath.startsWith('http://localhost:') || elem.imagepath.startsWith('https://localhost:')) {
          const pathMatch = elem.imagepath.match(/\/projects\/(.+)$/);
        if (pathMatch) {
          elem.imagepath = `${serverUrl}/projects/${pathMatch[1]}`;
          console.log(`[DataService] Converted image URL from localhost to: ${elem.imagepath}`);
        }
      }
    }

     if (elem.VideoPath && typeof elem.VideoPath === 'string') {
      if (elem.VideoPath.startsWith('http://localhost:') || elem.VideoPath.startsWith('https://localhost:')) {
         const pathMatch = elem.VideoPath.match(/\/projects\/(.+)$/);
        if (pathMatch) {
          elem.VideoPath = `${serverUrl}/projects/${pathMatch[1]}`;
          console.log(`[DataService] Converted video URL from localhost to: ${elem.VideoPath}`);
        }
      }
    }
  }


  private deserializeProject(data: any): Project {
    console.log(`[DataService] deserializeProject called with data.name="${data.name}", data.projectType="${data.projectType}"`);
    const project = new Project(data.name, data.owner_name, data.projectType);
    console.log(`[DataService] Created project with name="${project.name}"`);
    (project as any).isLocal = data.projectType !== 'hosted';

    if (data.grid && Array.isArray(data.grid)) {
      data.grid.forEach((gridData: any) => {
        const grid = new Grid(gridData.name);
        if (gridData.Screen_elements && Array.isArray(gridData.Screen_elements)) {
          gridData.Screen_elements.forEach((elementData: any) => {
            const element = objects_builder.rebuild(elementData);
            if (element) {
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

  updateSettings(settings: settings): void {
    const user = this.getCurrentUser();
    if (user) {
      user.settings = settings;
         this.saveUserDataToStorage();
      this.saveUserToBackend(user);


      this.currentUserSubject.next(user);
    }
  }

   private saveUserDataToStorage(): void {
     if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const user = this.getCurrentUser();
    if (user && this.currentUserName) {
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
 
  async saveUserToBackend(user: User): Promise<boolean> {
    try {
      console.log(`[DataService] Saving user "${user.name}" to backend...`);

       const serializedUser = this.serializeUserForSaving(user);

      const response = await firstValueFrom(
        this.socketService.saveUser(serializedUser)
      );

      if (response && response.success) {
        console.log(`[DataService] ✓ User "${user.name}" saved to backend successfully`);
        return true;
      }

      console.error(`[DataService] Failed to save user to backend:`, response?.message);
      return false;
    } catch (error) {
      console.error('[DataService] Error saving user to backend:', error);
      return false;
    }
  }

  async loadUserFromBackend(username: string): Promise<User | null> {
    try {
      console.log(`[DataService] Loading user "${username}" from backend...`);

      const response = await firstValueFrom(
        this.socketService.loadUser(username)
      );

      if (response && response.success && response.user) {
        console.log(`[DataService] ✓ User "${username}" loaded from backend`);
          const user = this.deserializeUser(response.user);
        return user;
      }

      console.log(`[DataService] User "${username}" not found on backend`);
      return null;
    } catch (error) {
      console.error('[DataService] Error loading user from backend:', error);
      return null;
    }
  }

  private serializeUserForSaving(user: User): any {
    if (user.toJSON && typeof user.toJSON === 'function') {
      return user.toJSON();
    }

    return {
      type: 'User',
      name: user.name,
      settings: this.serializeSettings(user.settings),
      contacts: user.contacts.map((c: any) => ({
        type: 'contact',
        name: c.name,
        contact_detail: c.contact_detail
      })),
      projectReferences: user.projects.map(p => ({
        name: p.name,
        projectType: (p as any).projectType || p.project_type || 'local'
      }))
    };
  }

  private serializeSettings(s: settings): any {
    if (s.toJSON && typeof s.toJSON === 'function') {
      return s.toJSON();
    }
    return {
      type: 'settings',
      recieve_notifications: s.recieve_notifications,
      allow_invite: s.allow_invite,
      allow_google_calender: s.allow_google_calender
    };
  }


  private deserializeUser(data: any): User {
    const userSettings = new settings();
    if (data.settings) {
      userSettings.recieve_notifications = data.settings.recieve_notifications !== undefined ? data.settings.recieve_notifications : true;
      userSettings.allow_invite = data.settings.allow_invite !== undefined ? data.settings.allow_invite : true;
      userSettings.allow_google_calender = data.settings.allow_google_calender !== undefined ? data.settings.allow_google_calender : true;
    }

    const user = new User(data.name, userSettings);

    return user;
  }

   private saveToStorage(): void {
    this.saveUserDataToStorage();
  }

   updateCurrentUser(): void {
    const user = this.getCurrentUser();
    this.currentUserSubject.next(user);
  }

   logout(): void {
    this.currentUserName = null;
    this.currentUserSubject.next(null);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem("current_user_name");
    }
  }

  
  updateUsernameToEmail(email: string): User | null {
    if (!isPlatformBrowser(this.platformId)) {  
      return null;
    }

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


    currentUser.name = email;


    this.usersData.delete(oldName);


    this.usersData.set(email, currentUser);
    this.currentUserName = email;

 
    localStorage.setItem("current_user_name", email);
    localStorage.setItem('clarity_users', JSON.stringify(Array.from(this.usersData.entries())));

    this.currentUserSubject.next(currentUser);

    this.socketService.identifyUser(email);

    this.saveUserToBackend(currentUser);
    console.log('[DataService] Username updated successfully to:', email);
    return currentUser;
  }

  async loadUserProjects(): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) {
      console.error('[DataService] No user logged in');
      return;
    }

    console.log(`[DataService] Loading projects for user: ${user.name}`);

   
    user.projects = [];

    const localProjects = await this.listProjects('local');

    const hostedProjects = await this.listProjects('hosted');
    user.projects = [...localProjects, ...hostedProjects];

    console.log(`[DataService] Loaded ${user.projects.length} projects for user ${user.name}`);


    this.currentUserSubject.next(user);


    this.saveUserDataToStorage();
  }

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
      const response = await firstValueFrom(
        this.socketService.importGoogleContacts(user.name)
      );
          if (response.success) {
        console.log(`[DataService] ✓ Successfully imported contacts:`, response);
        
          const updatedUser = await this.loadUserFromBackend(user.name);
        if (updatedUser) {
  
          user.contacts = updatedUser.contacts || [];
          this.currentUserSubject.next(user);
          this.saveUserDataToStorage();
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

  getUserContacts(): any[] {
    const user = this.getCurrentUser();
    return user?.contacts || [];
  }
}

