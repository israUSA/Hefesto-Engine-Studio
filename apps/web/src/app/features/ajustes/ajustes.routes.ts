import { Route } from '@angular/router';
import { PlaceholderPage } from '../placeholder/placeholder-page';
import { AjustesShell } from './ajustes-shell';

export const ajustesRoutes: Route[] = [
  {
    path: '',
    component: AjustesShell,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'proveedores' },
      {
        path: 'proveedores',
        loadComponent: () => import('./proveedores/proveedores-page').then((m) => m.ProveedoresPage),
      },
      {
        path: 'voces',
        component: PlaceholderPage,
        data: { title: 'Voces', detail: 'La biblioteca de voces llega en la próxima entrega.' },
      },
      {
        path: 'rutas',
        component: PlaceholderPage,
        data: { title: 'Rutas y disco', detail: 'La configuración de rutas llega en la próxima entrega.' },
      },
      {
        path: 'cuentas',
        component: PlaceholderPage,
        data: { title: 'Cuentas y OAuth', detail: 'La gestión de cuentas llega en la próxima entrega.' },
      },
      {
        path: 'limites',
        component: PlaceholderPage,
        data: { title: 'Límites y costos', detail: 'Las alertas de presupuesto llegan en la próxima entrega.' },
      },
      {
        path: 'sistema',
        component: PlaceholderPage,
        data: { title: 'Sistema', detail: 'La información del sistema llega en la próxima entrega.' },
      },
      {
        path: 'apariencia',
        component: PlaceholderPage,
        data: { title: 'Apariencia', detail: 'Más opciones de apariencia llegan en la próxima entrega.' },
      },
    ],
  },
];
