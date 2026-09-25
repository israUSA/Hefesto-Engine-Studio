import { Route } from '@angular/router';
import { PlaceholderPage } from '../placeholder/placeholder-page';

export const canalesRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./canales-list-page').then((m) => m.CanalesListPage),
  },
  {
    path: ':slug',
    loadComponent: () => import('./canal-detalle/canal-detalle-page').then((m) => m.CanalDetallePage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'videos' },
      {
        path: 'videos',
        loadComponent: () => import('./canal-detalle/videos-tab').then((m) => m.VideosTab),
      },
      {
        path: 'guiones',
        component: PlaceholderPage,
        data: { title: 'Guiones', detail: 'El listado de guiones del canal llega en la próxima entrega.' },
      },
      {
        path: 'identidad',
        loadComponent: () => import('./canal-detalle/identidad-tab').then((m) => m.IdentidadTab),
      },
      {
        path: 'calendario',
        component: PlaceholderPage,
        data: { title: 'Calendario', detail: 'El calendario del canal llega en la próxima entrega.' },
      },
      {
        path: 'metricas',
        component: PlaceholderPage,
        data: { title: 'Métricas', detail: 'Las métricas del canal llegan en la próxima entrega.' },
      },
    ],
  },
];
