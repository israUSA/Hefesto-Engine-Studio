import { Inject } from '@nestjs/common';
import type { Capability, TextRole } from '@hefesto/shared-types';
import { sql } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command, CommandRunner, Option } from 'nest-commander';
import { env, paths } from '../config/env';
import { DB, type DbInstance } from '../db/db.token';
import { ProviderBindingsRepository, ProviderConfigsRepository } from '../db/repositories';
import { bibleVerses } from '../db/schema';
import { importBundledBible } from '../db/bundled-bible';
import { seedDatabase, seedProviderCatalog } from '../db/seed';
import { newId } from '../db/util';

interface SetupFlags {
  offline?: boolean;
  demo?: boolean;
  resetBindings?: boolean;
}

const OFFLINE_BINDINGS: { capability: Capability; role?: TextRole }[] = [
  { capability: 'text', role: 'ideas' },
  { capability: 'text', role: 'script' },
  { capability: 'text', role: 'metadata' },
  { capability: 'text', role: 'keywords' },
  { capability: 'tts' },
  { capability: 'stock' },
  { capability: 'transcribe' },
];

@Command({
  name: 'setup',
  description: 'Crea la base, carga el catálogo de proveedores e importa la RV1909 (sin canales)',
})
export class SetupCommand extends CommandRunner {
  constructor(
    @Inject(DB) private readonly db: DbInstance,
    private readonly configs: ProviderConfigsRepository,
    private readonly bindings: ProviderBindingsRepository,
  ) {
    super();
  }

  async run(_args: string[], flags: SetupFlags): Promise<void> {
    console.log(`Base de datos: ${paths.db()}`);
    const seed = seedDatabase(this.db, {
      demo: flags.demo,
      resetBindings: flags.resetBindings,
    });
    console.log(`✓ Catálogo de ${seed.providerConfigs.length} proveedores`);
    if (flags.demo) console.log(`✓ ${seed.channels.length} canales de demostración (plantillas de nicho)`);

    this.importBible();

    if (flags.offline) {
      seedProviderCatalog(this.db, { demo: true }); // adds the offline "fake" provider
      const fake = this.configs.findByName('fake');
      if (!fake) throw new Error('No existe el proveedor "fake"');
      for (const b of OFFLINE_BINDINGS) {
        this.bindings.upsert({ channelId: null, ...b, providerConfigId: fake.id, params: {}, fallbackIds: [] });
      }
      console.log('✓ Modo sin conexión: texto, voz, stock y transcripción usan el proveedor "fake"');
      console.log('  Para volver a los proveedores reales: setup --reset-bindings');
    }
  }

  private importBible(): void {
    const { imported, verses } = importBundledBible(this.db);
    console.log(imported ? `✓ RV1909 importada (${verses} versículos)` : `✓ RV1909 ya importada (${verses} versículos)`);
  }


  @Option({ flags: '--demo', description: 'Crear canales de demostración a partir de las plantillas' })
  parseDemo(): boolean {
    return true;
  }

  @Option({ flags: '--reset-bindings', description: 'Volver a los proveedores por defecto (Gemini, Pexels, whisper.cpp)' })
  parseResetBindings(): boolean {
    return true;
  }

  @Option({ flags: '--offline', description: 'Usar el proveedor "fake" (sin claves ni internet)' })
  parseOffline(): boolean {
    return true;
  }
}
