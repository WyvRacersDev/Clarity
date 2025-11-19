import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { DataService } from '../../services/data.service';
import { User } from '../../../../../shared_models/models/user.model';
import { Project } from '../../../../../shared_models/models/project.model';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.css']
})
export class ProjectsComponent implements OnInit {
  currentUser: User | null = null;
  showCreateModal = false;
  newProjectName = '';
  projectType: 'local' | 'hosted' = 'local';

  constructor(
    private dataService: DataService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.dataService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });
  }

  openCreateModal(): void {
    this.showCreateModal = true;
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
    this.newProjectName = '';
  }

  createProject(): void {
    if (this.newProjectName.trim()) {
      const newProject = new Project(this.newProjectName.trim());
      // Add project type metadata
      (newProject as any).projectType = this.projectType;
      (newProject as any).isLocal = this.projectType === 'local';
      
      if (this.currentUser) {
        this.currentUser.projects.push(newProject);
        this.dataService.updateCurrentUser();
      }
      
      this.closeCreateModal();
    }
  }

  isLocalProject(project: Project): boolean {
    return (project as any).isLocal !== false; // Default to local if not set
  }

  selectProject(index: number): void {
    this.router.navigate(['/projects', index]);
  }

  deleteProject(index: number, event: Event): void {
    event.stopPropagation();
    if (this.currentUser && confirm('Are you sure you want to delete this project?')) {
      this.currentUser.projects.splice(index, 1);
      this.dataService.updateCurrentUser();
    }
  }
}