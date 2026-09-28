import { Route } from '@angular/router';

export const driveRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./drive-page').then((m) => m.DrivePage),
  },
];
