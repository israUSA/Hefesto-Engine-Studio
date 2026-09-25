import { Route } from '@angular/router';
import { PlaceholderPage } from './features/placeholder/placeholder-page';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'hoy' },
  {
    path: 'hoy',
    loadChildren: () => import('./features/hoy/hoy.routes').then((m) => m.hoyRoutes),
  },
  {
    path: 'ideas-y-guiones',
    loadChildren: () => import('./features/ideas/ideas.routes').then((m) => m.ideasRoutes),
  },
  {
    path: 'producir',
    loadChildren: () => import('./features/producir/producir.routes').then((m) => m.producirRoutes),
  },
  {
    path: 'cola',
    loadChildren: () => import('./features/cola/cola.routes').then((m) => m.colaRoutes),
  },
  {
    path: 'biblioteca',
    loadChildren: () => import('./features/biblioteca/biblioteca.routes').then((m) => m.bibliotecaRoutes),
  },
  {
    path: 'calendario',
    component: PlaceholderPage,
    data: { title: 'Calendario', detail: 'El calendario de publicación llega en la próxima entrega.' },
  },
  {
    path: 'drive',
    component: PlaceholderPage,
    data: { title: 'Drive', detail: 'La vista de almacenamiento llega en la próxima entrega.' },
  },
  {
    path: 'costos',
    component: PlaceholderPage,
    data: { title: 'Costos', detail: 'El panel de costos llega en la próxima entrega.' },
  },
  {
    path: 'consola',
    loadChildren: () => import('./features/consola/consola.routes').then((m) => m.consolaRoutes),
  },
  {
    path: 'canales',
    loadChildren: () => import('./features/canales/canales.routes').then((m) => m.canalesRoutes),
  },
  {
    path: 'ajustes',
    loadChildren: () => import('./features/ajustes/ajustes.routes').then((m) => m.ajustesRoutes),
  },
  { path: '**', redirectTo: 'hoy' },
];
