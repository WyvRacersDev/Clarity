import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { LayoutComponent } from './components/layout/layout.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { ProjectsComponent } from './components/projects/projects.component';
import { ProjectDetailComponent } from './components/projects/project-detail/project-detail.component';
import { TasksComponent } from './components/tasks/tasks.component';
import { AnalyticsComponent } from './components/analytics/analytics.component';
import { AiInsightsComponent } from './components/ai-insights/ai-insights.component';
import { SettingsComponent } from './components/settings/settings.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        redirectTo: '/dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        component: DashboardComponent
      },
      {
        path: 'projects',
        component: ProjectsComponent
      },
      {
        path: 'projects/:id',
        component: ProjectDetailComponent
      },
      {
        path: 'tasks',
        component: TasksComponent
      },
      {
        path: 'analytics',
        component: AnalyticsComponent
      },
      {
        path: 'ai-insights',
        component: AiInsightsComponent
      },
      {
        path: 'settings',
        component: SettingsComponent
      }
    ]
  },
  {
    path: '**',
    redirectTo: '/dashboard'
  }
];