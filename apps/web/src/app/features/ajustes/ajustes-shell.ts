import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Icon, IconName } from '@hefesto/web-ui';

interface AjustesTab {
  path: string;
  label: string;
  icon: IconName;
}

const TABS: AjustesTab[] = [
  { path: 'proveedores', label: 'Proveedores', icon: 'zap' },
  { path: 'voces', label: 'Voces', icon: 'mic' },
  { path: 'rutas', label: 'Rutas y disco', icon: 'folder' },
  { path: 'cuentas', label: 'Cuentas y OAuth', icon: 'users' },
  { path: 'limites', label: 'Límites y costos', icon: 'wallet' },
  { path: 'sistema', label: 'Sistema', icon: 'monitor' },
  { path: 'apariencia', label: 'Apariencia', icon: 'sun' },
];

/** Ajustes layout: left sub-nav (Proveedores, Voces, …) + the active tab's content. */
@Component({
  selector: 'hf-ajustes-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Icon],
  template: `
    <div class="hf-ajustes">
      <nav class="hf-ajustes__nav">
        <h1 class="hf-ajustes__title">Ajustes</h1>
        @for (tab of tabs; track tab.path) {
          <a class="hf-ajustes__tab" [routerLink]="tab.path" routerLinkActive="hf-ajustes__tab--active">
            <hf-icon [name]="tab.icon" [size]="15" />
            {{ tab.label }}
          </a>
        }
      </nav>
      <div class="hf-ajustes__content">
        <router-outlet />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .hf-ajustes {
      display: flex;
      gap: var(--space-8);
      height: 100%;
      align-items: flex-start;
    }
    .hf-ajustes__nav {
      flex: none;
      width: 200px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      position: sticky;
      top: 0;
    }
    .hf-ajustes__title {
      font-family: var(--font-serif);
      font-size: var(--text-2xl);
      color: var(--text);
      margin-bottom: var(--space-4);
      padding: 0 var(--space-3);
    }
    .hf-ajustes__tab {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      height: 34px;
      padding: 0 var(--space-3);
      border-radius: var(--radius-md);
      color: var(--text-2);
      text-decoration: none;
      font-size: var(--text-base);
    }
    .hf-ajustes__tab:hover {
      color: var(--text);
      background: var(--surface-2);
    }
    .hf-ajustes__tab--active {
      color: var(--accent);
      background: var(--accent-soft);
    }
    .hf-ajustes__content {
      flex: 1;
      min-width: 0;
    }
  `,
})
export class AjustesShell {
  readonly tabs = TABS;
}
