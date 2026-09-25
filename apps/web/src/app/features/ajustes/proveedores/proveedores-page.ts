import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { BindingDto, Capability, HealthResult, ProviderDto, SecretDto } from '@hefesto/shared-types';
import {
  Button,
  EmptyState,
  Icon,
  IconName,
  Input,
  Select,
  SelectOption,
  Skeleton,
  StatusChip,
  Tag,
} from '@hefesto/web-ui';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../../core/api-client';
import { ToastService } from '../../../core/toast.service';
import { AddProviderDialog } from './add-provider-dialog';
import { ChangeSecretDialog } from './change-secret-dialog';

interface CapabilityMeta {
  label: string;
  icon: IconName;
}

const CAPABILITY_META: Record<Capability, CapabilityMeta> = {
  text: { label: 'Texto', icon: 'edit' },
  tts: { label: 'Voz', icon: 'volume' },
  transcribe: { label: 'Transcripción', icon: 'mic' },
  image: { label: 'Imágenes IA', icon: 'sparkles' },
  video: { label: 'Video IA', icon: 'clapperboard' },
  stock: { label: 'Stock', icon: 'image' },
  music: { label: 'Música', icon: 'volume' },
  storage: { label: 'Almacenamiento', icon: 'drive' },
  publish: { label: 'Publicación', icon: 'external-link' },
  notify: { label: 'Avisos', icon: 'alert-circle' },
  embedding: { label: 'Embeddings', icon: 'database' },
};

const CAPABILITY_ORDER: Capability[] = [
  'text',
  'tts',
  'image',
  'stock',
  'video',
  'transcribe',
  'storage',
  'music',
  'publish',
  'notify',
  'embedding',
];

const KIND_LABEL = { cloud: 'nube', local: 'local', manual: 'manual' } as const;

interface ProviderRow {
  capability: Capability;
  label: string;
  icon: IconName;
  binding: BindingDto;
  provider: ProviderDto | null;
  options: SelectOption[];
  roleCount: number;
  fallbackLabel: string;
  secretLast4: string | null;
  secretSource: 'vault' | 'env' | null;
  health: (HealthResult & { checkedAt?: string }) | null;
  testing: boolean;
}

/**
 * Ajustes → Proveedores: one row per capability, each bound to a swappable
 * provider instance (nube / local / manual) with a fallback chain, a masked
 * secret and a "Probar" health check. See docs/13-proveedores-intercambiables.md.
 */
@Component({
  selector: 'hf-proveedores-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Button,
    Icon,
    Input,
    Select,
    Skeleton,
    StatusChip,
    Tag,
    EmptyState,
    ChangeSecretDialog,
    AddProviderDialog,
  ],
  templateUrl: './proveedores-page.html',
  styleUrl: './proveedores-page.css',
})
export class ProveedoresPage {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly rows = signal<ProviderRow[]>([]);

  readonly addProviderOpen = signal(false);
  readonly changeSecretFor = signal<string | null>(null);

  // Queue limits row. Only "net" concurrency maps to a real endpoint
  // (PATCH /api/queue/lanes/:lane); the rest are local-only until the API
  // exposes budget/retry settings (see the final report's open issues).
  readonly netConcurrency = signal(3);
  readonly budgetUsd = signal(30);
  readonly retries = signal(3);
  readonly pauseOnQaFail = signal(true);
  readonly savingLimits = signal(false);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({
      providers: this.api.listProviders(),
      bindings: this.api.listBindings(null),
      secrets: this.api.listSecrets(),
      queue: this.api.getQueue(),
    }).subscribe({
      next: ({ providers, bindings, secrets, queue }) => {
        this.rows.set(this.buildRows(providers, bindings, secrets));
        this.netConcurrency.set(queue.lanes.net?.concurrency ?? 3);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No se pudo conectar con el motor.');
      },
    });
  }

  private buildRows(providers: ProviderDto[], bindings: BindingDto[], secrets: SecretDto[]): ProviderRow[] {
    const global = bindings.filter((b) => b.channelId === null);
    const byCapability = new Map<Capability, BindingDto[]>();
    for (const binding of global) {
      const list = byCapability.get(binding.capability) ?? [];
      list.push(binding);
      byCapability.set(binding.capability, list);
    }

    const rows: ProviderRow[] = [];
    for (const capability of CAPABILITY_ORDER) {
      const bucket = byCapability.get(capability);
      if (!bucket || bucket.length === 0) {
        continue;
      }
      const binding = bucket.find((b) => !b.role) ?? bucket[0];
      const provider = providers.find((p) => p.config.id === binding.providerConfigId) ?? null;
      const options = providers
        .filter((p) => p.config.capabilities.includes(capability))
        .map((p) => ({ value: p.config.id, label: p.config.name }));
      const fallbackNames = binding.fallbackIds
        .map((id) => providers.find((p) => p.config.id === id)?.config.name ?? id)
        .filter(Boolean);
      const secret = provider?.secret;
      const secretSource = secret ? secrets.find((s) => s.name === secret.name)?.source ?? 'env' : null;

      rows.push({
        capability,
        label: CAPABILITY_META[capability].label,
        icon: CAPABILITY_META[capability].icon,
        binding,
        provider,
        options,
        roleCount: bucket.length,
        fallbackLabel: fallbackNames.length ? `respaldo: ${fallbackNames.join(' · ')}` : 'sin respaldo',
        secretLast4: secret?.present ? secret.last4 ?? null : null,
        secretSource,
        health: provider?.lastHealth ?? null,
        testing: false,
      });
    }
    return rows;
  }

  kindOf(row: ProviderRow): string {
    return row.provider ? KIND_LABEL[row.provider.manifest.kind] : '';
  }

  onProviderChange(row: ProviderRow, providerConfigId: string): void {
    const previousId = row.binding.providerConfigId;
    if (previousId === providerConfigId) {
      return;
    }
    const nextBinding: BindingDto = { ...row.binding, providerConfigId };
    this.applyBinding(nextBinding, () => this.applyBinding({ ...row.binding, providerConfigId: previousId }, undefined, true));
  }

  private applyBinding(binding: BindingDto, onUndo?: () => void, silent = false): void {
    this.api.saveBinding(binding).subscribe({
      next: () => {
        this.patchRow(binding);
        if (!silent) {
          this.toasts.show('Cambios guardados · se aplican en la próxima tarea', {
            tone: 'ok',
            actionLabel: onUndo ? 'Deshacer' : undefined,
            action: onUndo,
          });
        }
      },
      error: () => this.toasts.error('No se pudo guardar el cambio de proveedor.'),
    });
  }

  private patchRow(binding: BindingDto): void {
    this.rows.update((rows) =>
      rows.map((row) => {
        if (row.capability !== binding.capability || row.binding.role !== binding.role) {
          return row;
        }
        const providers = this.rows().map((r) => r.provider).filter((p): p is ProviderDto => !!p);
        const provider = providers.find((p) => p.config.id === binding.providerConfigId) ?? row.provider;
        return { ...row, binding, provider };
      }),
    );
  }

  test(row: ProviderRow): void {
    if (!row.provider) {
      return;
    }
    this.setTesting(row.capability, true);
    this.api.testProvider(row.provider.config.id).subscribe({
      next: (result) => {
        this.setTesting(row.capability, false, { ...result, checkedAt: new Date().toISOString() });
      },
      error: () => {
        this.setTesting(row.capability, false, {
          ok: false,
          message: 'No se pudo probar el proveedor.',
          checkedAt: new Date().toISOString(),
        });
      },
    });
  }

  private setTesting(capability: Capability, testing: boolean, health?: HealthResult & { checkedAt: string }): void {
    this.rows.update((rows) =>
      rows.map((row) => (row.capability === capability ? { ...row, testing, health: health ?? row.health } : row)),
    );
  }

  openChangeSecret(row: ProviderRow): void {
    if (row.provider?.secret) {
      this.changeSecretFor.set(row.provider.secret.name);
    }
  }

  saveLimits(): void {
    this.savingLimits.set(true);
    this.api.setLaneConcurrency('net', this.netConcurrency()).subscribe({
      next: () => {
        this.savingLimits.set(false);
        this.toasts.ok('Límites de la cola guardados.');
      },
      error: () => {
        this.savingLimits.set(false);
        this.toasts.error('No se pudo guardar el límite de red.');
      },
    });
  }

  resetLimits(): void {
    this.netConcurrency.set(3);
    this.budgetUsd.set(30);
    this.retries.set(3);
    this.pauseOnQaFail.set(true);
  }

  onProviderCreated(): void {
    this.load();
  }

  onSecretSaved(): void {
    this.load();
  }
}
