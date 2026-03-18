import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../services/supabase.service';
import { SupabaseAuthService } from '../../services/supabase-auth.service';
import { DatabaseService } from '../../services/database.service';

interface ProjectInfo {
  name: string;
  projectType: string;
  id?: string;
}

interface UserInfo {
  email?: string;
  name?: string;
  id?: string;
}

@Component({
  selector: 'app-supabase-test',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="test-container">
      <h2>Supabase Connection Test</h2>

      <!-- Connection Status -->
      <div class="test-section">
        <h3>Connection Status</h3>
        <div class="status-grid">
          <div class="status-item">
            <span class="label">Supabase Client:</span>
            <span [class]="clientReady ? 'status-ok' : 'status-error'">
              {{ clientReady ? 'Connected' : 'Not Connected' }}
            </span>
          </div>
          <div class="status-item">
            <span class="label">Auth Session:</span>
            <span [class]="hasSession ? 'status-ok' : 'status-error'">
              {{ hasSession ? 'Active' : 'None' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Current User -->
      <div class="test-section" *ngIf="currentUser">
        <h3>Current User</h3>
        <div class="info-box">
          <p><strong>Email:</strong> {{ currentUser.email || 'N/A' }}</p>
          <p><strong>Username:</strong> {{ currentUser.name || 'N/A' }}</p>
          <p><strong>ID:</strong> {{ currentUser.id || 'N/A' }}</p>
        </div>
      </div>

      <!-- Projects -->
      <div class="test-section">
        <h3>Projects ({{ projects.length }})</h3>
        <button class="test-btn" (click)="loadProjects()" [disabled]="loading">
          {{ loading ? 'Loading...' : 'Load Projects' }}
        </button>
        <div class="projects-list" *ngIf="projects.length > 0">
          <div class="project-item" *ngFor="let project of projects">
            <span>{{ project.name }}</span>
            <span class="project-type">{{ project.projectType || 'local' }}</span>
          </div>
        </div>
        <p *ngIf="projects.length === 0 && !loading" class="no-data">No projects found</p>
      </div>

      <!-- Database Test -->
      <div class="test-section">
        <h3>Database Operations</h3>
        <div class="button-group">
          <button class="test-btn" (click)="testDatabaseRead()" [disabled]="testing">
            {{ testing ? 'Testing...' : 'Test Read' }}
          </button>
          <button class="test-btn success" (click)="testCreateProject()" [disabled]="testing || !hasSession">
            Test Create Project
          </button>
        </div>
        <div class="result-box" *ngIf="testResult">
          <pre>{{ testResult | json }}</pre>
        </div>
      </div>

      <!-- Error Display -->
      <div class="error-box" *ngIf="error">
        <h4>Error</h4>
        <p>{{ error }}</p>
        <button class="test-btn" (click)="clearError()">Dismiss</button>
      </div>
    </div>
  `,
  styles: [`
    .test-container {
      max-width: 800px;
      margin: 2rem auto;
      padding: 2rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    h2 {
      color: #0099FF;
      margin-bottom: 1.5rem;
      font-size: 1.5rem;
    }

    h3 {
      color: rgba(255, 255, 255, 0.9);
      font-size: 1.1rem;
      margin-bottom: 1rem;
    }

    .test-section {
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .test-section:last-child {
      border-bottom: none;
      margin-bottom: 0;
    }

    .status-grid {
      display: flex;
      gap: 2rem;
      flex-wrap: wrap;
    }

    .status-item {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .label {
      color: rgba(255, 255, 255, 0.6);
    }

    .status-ok {
      color: #3AFF6F;
      font-weight: 600;
    }

    .status-error {
      color: #F44336;
      font-weight: 600;
    }

    .info-box {
      background: rgba(0, 0, 0, 0.3);
      padding: 1rem;
      border-radius: 8px;
      color: rgba(255, 255, 255, 0.8);
    }

    .info-box p {
      margin: 0.5rem 0;
    }

    .test-btn {
      padding: 10px 20px;
      background: rgba(0, 153, 255, 0.2);
      color: #FFFFFF;
      border: 1px solid rgba(0, 153, 255, 0.4);
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s;
    }

    .test-btn:hover:not(:disabled) {
      background: rgba(0, 153, 255, 0.3);
      border-color: rgba(0, 153, 255, 0.6);
    }

    .test-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .test-btn.success {
      background: rgba(58, 255, 111, 0.15);
      border-color: rgba(58, 255, 111, 0.3);
    }

    .test-btn.success:hover:not(:disabled) {
      background: rgba(58, 255, 111, 0.25);
      border-color: rgba(58, 255, 111, 0.5);
    }

    .button-group {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .projects-list {
      margin-top: 1rem;
    }

    .project-item {
      display: flex;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      margin-bottom: 0.5rem;
      color: rgba(255, 255, 255, 0.8);
    }

    .project-type {
      font-size: 0.8rem;
      padding: 2px 8px;
      background: rgba(0, 153, 255, 0.2);
      border-radius: 4px;
      color: #0099FF;
    }

    .no-data {
      color: rgba(255, 255, 255, 0.4);
      font-style: italic;
    }

    .result-box {
      margin-top: 1rem;
      background: rgba(0, 0, 0, 0.3);
      padding: 1rem;
      border-radius: 8px;
      overflow: auto;
    }

    .result-box pre {
      margin: 0;
      color: rgba(255, 255, 255, 0.8);
      font-size: 0.85rem;
      white-space: pre-wrap;
    }

    .error-box {
      background: rgba(244, 67, 54, 0.1);
      border: 1px solid rgba(244, 67, 54, 0.3);
      padding: 1rem;
      border-radius: 8px;
      margin-top: 1rem;
    }

    .error-box h4 {
      color: #F44336;
      margin: 0 0 0.5rem 0;
    }

    .error-box p {
      color: rgba(255, 255, 255, 0.7);
      margin: 0 0 1rem 0;
    }
  `]
})
export class SupabaseTestComponent implements OnInit {
  clientReady = false;
  hasSession = false;
  currentUser: UserInfo | null = null;
  projects: ProjectInfo[] = [];
  loading = false;
  testing = false;
  testResult: any = null;
  error: string | null = null;

  private currentUserId: string | null = null;

  constructor(
    private supabaseService: SupabaseService,
    private supabaseAuth: SupabaseAuthService,
    private databaseService: DatabaseService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.checkConnection();
  }

  async checkConnection(): Promise<void> {
    try {
      // Check if Supabase client is initialized
      this.clientReady = !!this.supabaseService.client;

      // Check session
      const session = await this.supabaseAuth.getSession();
      this.hasSession = !!session;

      // Get current user
      if (this.hasSession) {
        const user = this.supabaseAuth.getCurrentUser();
        if (user) {
          this.currentUser = {
            email: (user as any).email,
            name: user.name,
            id: (user as any).id
          };
          this.currentUserId = (user as any).id;
        }
      }
    } catch (err) {
      console.error('Connection check failed:', err);
      this.error = `Connection check failed: ${err}`;
    }
  }

  async loadProjects(): Promise<void> {
    this.loading = true;
    this.error = null;

    try {
      if (this.currentUserId) {
        const loadedProjects = await this.databaseService.getProjects(this.currentUserId);
        this.projects = loadedProjects.map(p => ({
          name: p.name,
          projectType: (p as any).projectType || 'local',
          id: (p as any).id
        }));
      } else {
        this.error = 'No authenticated user found';
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
      this.error = `Failed to load projects: ${err}`;
    } finally {
      this.loading = false;
    }
  }

  async testDatabaseRead(): Promise<void> {
    this.testing = true;
    this.testResult = null;
    this.error = null;

    try {
      // Test reading from profiles table
      const { data, error } = await this.supabaseService.client
        .from('profiles')
        .select('id, username, email')
        .limit(5);

      if (error) {
        throw error;
      }

      this.testResult = {
        success: true,
        table: 'profiles',
        rowCount: data?.length || 0,
        data
      };
    } catch (err) {
      console.error('Database read test failed:', err);
      this.error = `Database read test failed: ${err}`;
      this.testResult = { success: false, error: String(err) };
    } finally {
      this.testing = false;
    }
  }

  async testCreateProject(): Promise<void> {
    this.testing = true;
    this.testResult = null;
    this.error = null;

    try {
      const project = await this.databaseService.createProject(
        `Test Project ${Date.now()}`,
        'local'
      );

      if (project) {
        this.testResult = {
          success: true,
          message: 'Project created successfully',
          project: {
            id: (project as any).id,
            name: project.name,
            type: (project as any).projectType
          }
        };
        // Refresh projects list
        await this.loadProjects();
      } else {
        throw new Error('Failed to create project - no result returned');
      }
    } catch (err) {
      console.error('Create project test failed:', err);
      this.error = `Create project test failed: ${err}`;
      this.testResult = { success: false, error: String(err) };
    } finally {
      this.testing = false;
    }
  }

  clearError(): void {
    this.error = null;
  }
}
