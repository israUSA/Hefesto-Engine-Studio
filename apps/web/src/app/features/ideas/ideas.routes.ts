import { Route } from '@angular/router';

/** Ideas y guiones: kanban board from idea to published. */
export const ideasRoutes: Route[] = [
  { path: '', loadComponent: () => import('./ideas-page').then((m) => m.IdeasPage) },
];
