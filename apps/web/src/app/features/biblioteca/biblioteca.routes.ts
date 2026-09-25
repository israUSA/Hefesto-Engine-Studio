import { Route } from '@angular/router';

/** Biblioteca: grid of every production with an inspector for the selected video. */
export const bibliotecaRoutes: Route[] = [
  { path: '', loadComponent: () => import('./biblioteca-page').then((m) => m.BibliotecaPage) },
];
