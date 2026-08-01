import { Routes } from '@angular/router';
import { WelcomeComponent } from './components/welcome/welcome.component';
import { LayoutComponent } from './components/layout/layout.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { ProjectsComponent } from './components/projects/projects.component';
import { ProjectDetailComponent } from './components/projects/project-detail/project-detail.component';
import { TasksComponent } from './components/tasks/tasks.component';
import { KanbanComponent } from './components/kanban/kanban.component';
import { TimelineComponent } from './components/timeline/timeline.component';
import { AnalyticsComponent } from './components/analytics/analytics.component';
import { AiInsightsComponent } from './components/ai-insights/ai-insights.component';
import { AssistantComponent } from './components/assistant/assistant.component';
import { ContactsComponent } from './components/contacts/contacts.component';
import { MessagesPageComponent } from './components/chat/messages-page.component';
import { SettingsComponent } from './components/settings/settings.component';
import { AuthCallbackComponent } from './components/auth-callback/auth-callback.component';
import { authGuard } from './guards/auth.guard';


export const routes: Routes = [
  {
    path: '',
    component: WelcomeComponent
  },
  {
    path: 'login',
    component: WelcomeComponent
  },
  {
    path: 'auth/callback',
    component: AuthCallbackComponent
  },
  {
    path: 'dashboard',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
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
        path: 'kanban',
        component: KanbanComponent
      },
      {
        path: 'timeline',
        component: TimelineComponent
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
        path: 'assistant',
        component: AssistantComponent
      },
      {
        path: 'contacts',
        component: ContactsComponent
      },
      {
        path: 'messages',
        component: MessagesPageComponent
      },
      {
        path: 'settings',
        component: SettingsComponent
      }
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];