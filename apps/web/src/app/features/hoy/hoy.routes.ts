import { Route } from '@angular/router';

/** Hoy: the day's dashboard. */
export const hoyRoutes: Route[] = [
  { path: '', loadComponent: () => import('./hoy-page').then((m) => m.HoyPage) },
];
