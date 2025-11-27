import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { DataService } from '../../services/data.service';
import { User } from '../../../../../shared_models/models/user.model';
import { Project } from '../../../../../shared_models/models/project.model';
import { isLocalhostServer } from '../../config/app.config';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.css']
})
export class ProjectsComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  showCreateModal = false;
  newProjectName = '';
  projectType: 'local' | 'hosted' = 'local';
  
  // Loading states
  isSaving = false;
  isDeleting = false;
  isLoading = false;
  deletingProjectIndex: number | null = null;
  
  // Prevent infinite loops
  private isLoadingProjects = false;
  private hasLoadedProjects = false;
  private userSubscription: any;

  constructor(
    private dataService: DataService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Reset loading flags when component initializes
    this.hasLoadedProjects = false;
    this.isLoadingProjects = false;
    
    // Get initial user state
    const initialUser = this.dataService.getCurrentUser();
    if (initialUser) {
      this.currentUser = initialUser;
      // Load projects immediately if user is already set
      this.loadProjectsFromServer();
    }
    
    // Subscribe to user changes
    this.userSubscription = this.dataService.currentUser$.subscribe(async user => {
      const previousUserName = this.currentUser?.name;
      this.currentUser = user;
      
      // Only load projects if:
      // 1. User is set
      // 2. User actually changed (different user ID)
      // 3. Not already loading
      if (user && !this.isLoadingProjects && previousUserName !== user.name) {
        this.hasLoadedProjects = false;
        await this.loadProjectsFromServer();
      }
    });
    
    // Subscribe to loading states
    this.dataService.savingProject$.subscribe(loading => {
      this.isSaving = loading;
      console.log('Saving state changed:', loading);
      this.cdr.detectChanges();
    });
    
    this.dataService.deletingProject$.subscribe(loading => {
      this.isDeleting = loading;
      this.cdr.detectChanges();
    });
    
    this.dataService.listingProjects$.subscribe(loading => {
      this.isLoading = loading;
      console.log('Loading projects state changed:', loading);
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }

  async loadProjectsFromServer(): Promise<void> {
    if (!this.currentUser) {
      console.log('No current user, skipping load');
      return;
    }
    
    if (this.isLoadingProjects) {
      console.log('Already loading projects, skipping');
      return;
    }
    
    this.isLoadingProjects = true;
    this.hasLoadedProjects = false; // Reset before loading
    try {
      console.log('Loading projects from server...');
      const isLocalhost = isLocalhostServer();
      console.log(`[ProjectsComponent] Server is localhost: ${isLocalhost}`);
      
      // Only load local projects if server is localhost
      // Always load hosted projects
      const loadPromises: Promise<Project[]>[] = [
        this.dataService.listProjects('hosted')
      ];
      
      if (isLocalhost) {
        loadPromises.push(this.dataService.listProjects('local'));
      }
      
      const results = await Promise.all(loadPromises);
      const hostedProjects = results[0];
      const localProjects = isLocalhost ? results[1] : [];
      
      // SIMPLE: Just combine the projects - they're already correctly typed from their directories
      console.log(`[ProjectsComponent] Local projects (only if localhost):`, localProjects.map(p => p.name));
      console.log(`[ProjectsComponent] Hosted projects:`, hostedProjects.map(p => p.name));
      const allProjects = [...localProjects, ...hostedProjects];
      console.log(`[ProjectsComponent] All projects:`, allProjects.map(p => ({ name: p.name, type: (p as any).projectType })));
      
      if (this.currentUser) {
        this.currentUser.projects.length = 0;
        this.currentUser.projects.push(...allProjects);
        console.log(`[ProjectsComponent] Final user projects:`, this.currentUser.projects.map(p => ({ name: p.name, type: (p as any).projectType })));
        this.hasLoadedProjects = true;
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('Error loading projects from server:', error);
      this.hasLoadedProjects = false; // Reset on error so it can retry
    } finally {
      this.isLoadingProjects = false;
      console.log('Loading projects completed');
      this.cdr.detectChanges(); // Force change detection
    }
  }

  openCreateModal(): void {
    this.showCreateModal = true;
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
    this.newProjectName = '';
  }

  async createProject(): Promise<void> {
    if (this.newProjectName.trim()) {
      const isLocalhost = isLocalhostServer();
      
      // Only allow creating local projects if server is localhost
      if (this.projectType === 'local' && !isLocalhost) {
        alert('Local projects can only be created when connected to a localhost server. Please switch to hosted projects or connect to localhost.');
        return;
      }
      
      const newProject = this.dataService.createProject(this.newProjectName.trim(), this.projectType);
      
      if (newProject && this.currentUser) {
        // Save to server
        const saved = await this.dataService.saveProject(newProject, this.projectType);
        if (saved) {
          console.log('Project created and saved successfully');
          // Reload projects to show the new one
          await this.loadProjectsFromServer();
        } else {
          console.error('Failed to save project to server');
        }
      }
      
      this.closeCreateModal();
    }
  }
  
  // Check if local projects are available (only on localhost)
  isLocalProjectsAvailable(): boolean {
    return isLocalhostServer();
  }

  isLocalProject(project: Project): boolean {
    return (project as any).isLocal !== false; // Default to local if not set
  }

  selectProject(index: number): void {
    this.router.navigate(['/projects', index]);
  }

  async deleteProject(index: number, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.currentUser && this.currentUser.projects[index]) {
      if (confirm('Are you sure you want to delete this project?')) {
        this.deletingProjectIndex = index;
        const project = this.currentUser.projects[index];
        const projectType = (project as any).projectType || 'local';
        const deleted = await this.dataService.deleteProject(project.name, projectType);
        this.deletingProjectIndex = null;
        if (deleted) {
          console.log('Project deleted successfully');
        } else {
          console.error('Failed to delete project from server');
          alert('Failed to delete project. Please try again.');
        }
      }
    }
  }
}