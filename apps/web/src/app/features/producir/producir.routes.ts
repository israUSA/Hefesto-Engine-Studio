import { Route } from '@angular/router';

export const producirRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./producir-page').then((m) => m.ProducirPage),
  },
];
