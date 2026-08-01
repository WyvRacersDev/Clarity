import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // The dashboard is an authenticated, Socket.IO-driven app shell. None of its
  // data (projects, tasks, analytics, the current user) exists on the server —
  // it all arrives over an authenticated socket in the browser. SSR-ing it just
  // produces an empty/skeleton shell that the client then fails to reconcile
  // during hydration, so client-loaded data never reaches the rendered DOM
  // (blank projects/analytics on direct load or refresh — A4/A5). Render the
  // whole dashboard on the CLIENT so a full page load behaves like an in-app
  // navigation, which renders correctly.
  {
    path: 'dashboard',
    renderMode: RenderMode.Client
  },
  {
    path: 'dashboard/projects/:id',
    renderMode: RenderMode.Client
  },
  // Public marketing/auth pages have no per-user data and are safe to prerender.
  {
    path: '',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'login',
    renderMode: RenderMode.Prerender
  },
  // Catch-all (dashboard children: projects, tasks, analytics, ai-insights,
  // assistant, contacts, settings, and auth/callback) — client-rendered.
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];
