import { Inject } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { ProviderConfigsRepository } from '../db/repositories';
import { SECRET_VAULT } from '../secrets/secrets.module';
import type { SecretVault } from '../secrets/secret-vault';

/**
 * Stand-in for Ajustes → Proveedores until the UI exists (Fase 2).
 *   keys             lista las claves que usan los proveedores y si están cargadas
 *   keys set NOMBRE  pide la clave con la entrada oculta y la guarda cifrada
 *   keys remove NOMBRE
 */
@Command({
  name: 'keys',
  arguments: '[action] [name]',
  description: 'Gestiona las claves de API (cifradas con Windows DPAPI)',
})
export class KeysCommand extends CommandRunner {
  constructor(
    @Inject(SECRET_VAULT) private readonly vault: SecretVault,
    private readonly configs: ProviderConfigsRepository,
  ) {
    super();
  }

  async run([action = 'list', name]: string[]): Promise<void> {
    switch (action) {
      case 'list':
        return this.list();
      case 'set': {
        if (!name) throw new Error('Uso: keys set NOMBRE (por ejemplo GEMINI_API_KEY)');
        const value = await promptHidden(`Pegá ${name} (no se muestra): `);
        await this.vault.set(name, value);
        console.log(`✓ ${name} guardada cifrada (…${value.trim().slice(-4)})`);
        return;
      }
      case 'remove':
        if (!name) throw new Error('Uso: keys remove NOMBRE');
        console.log((await this.vault.remove(name)) ? `✓ ${name} eliminada` : `${name} no estaba en la bóveda`);
        return;
      default:
        throw new Error(`Acción desconocida: ${action}. Usá list, set o remove.`);
    }
  }

  private list(): void {
    const needed = new Map<string, string[]>();
    for (const c of this.configs.list()) {
      if (!c.secretRef) continue;
      needed.set(c.secretRef, [...(needed.get(c.secretRef) ?? []), c.name]);
    }
    const known = new Map(this.vault.list([...needed.keys()]).map((s) => [s.name, s]));
    const names = new Set([...needed.keys(), ...known.keys()]);

    for (const n of [...names].sort()) {
      const info = known.get(n);
      const state = info ? `…${info.last4} (${info.source === 'vault' ? 'bóveda' : '.env'})` : 'falta';
      console.log(`${info ? '✓' : '✗'} ${n.padEnd(26)} ${state.padEnd(20)} ${(needed.get(n) ?? []).join(', ')}`);
    }
    if ([...needed.keys()].some((n) => !known.has(n))) {
      console.log('\nCargá las que faltan con: npx nx run api:cli keys set NOMBRE');
    }
  }
}

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => (data += d));
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0] ?? ''));
    });
  }
  return new Promise((resolve, reject) => {
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') {
          cleanup();
          return reject(new Error('Cancelado'));
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}
