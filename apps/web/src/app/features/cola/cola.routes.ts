import { Route } from '@angular/router';

export const colaRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./cola-page').then((m) => m.ColaPage),
  },
];
