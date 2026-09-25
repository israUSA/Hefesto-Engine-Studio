import { Route } from '@angular/router';

export const consolaRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./consola-page').then((m) => m.ConsolaPage),
  },
];
