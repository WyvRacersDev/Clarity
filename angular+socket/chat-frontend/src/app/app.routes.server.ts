import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Dynamic routes should use SSR, not prerender
  {
    path: 'dashboard/projects/:id',
    renderMode: RenderMode.Server
  },
  // Static routes can be prerendered
  {
    path: '',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'login',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'dashboard',
    renderMode: RenderMode.Server
  },
  // Catch-all for other routes
  {
    path: '**',
    renderMode: RenderMode.Server
  }
];
