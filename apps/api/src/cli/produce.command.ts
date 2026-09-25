import { Inject } from '@nestjs/common';
import type { ProductionSummary, ServerEvent } from '@hefesto/shared-types';
import { join } from 'node:path';
import { Command, CommandRunner, Option } from 'nest-commander';
import type { Subscription } from 'rxjs';
import { paths } from '../config/env';
import { ChannelsRepository } from '../db/repositories';
import { EventsService } from '../events/events.service';
import { QUEUE_API, type QueueApi } from '../queue/queue.contract';
import { QueueService, STAGE_LABELS } from '../queue/queue.service';

interface ProduceFlags {
  channel: string;
  count: number;
  topic?: string;
  resume?: string;
  force?: boolean;
}

/**
 * Enqueues the videos through the queue (same lanes, retries and events as the app) and
 * waits for them, printing the progress. Ctrl+C cancels the running jobs; they can be
 * retried later with --resume.
 */
@Command({ name: 'produce', description: 'Produce N shorts completos para un canal' })
export class ProduceCommand extends CommandRunner {
  constructor(
    @Inject(QUEUE_API) private readonly queue: QueueApi,
    private readonly queueService: QueueService,
    private readonly events: EventsService,
    private readonly channels: ChannelsRepository,
  ) {
    super();
  }

  async run(_args: string[], flags: ProduceFlags): Promise<void> {
    const order = new Map<string, number>();
    const activeJobs = new Map<string, string>();
    let buffered: ServerEvent[] | null = [];
    const print = (e: ServerEvent) => this.printEvent(e, order, activeJobs);
    const sub: Subscription = this.events.events$.subscribe((e) => (buffered ? buffered.push(e) : print(e)));

    let interrupted = false;
    const onSigint = () => {
      if (interrupted) process.exit(130);
      interrupted = true;
      console.log('\nDeteniendo… (Ctrl+C otra vez para forzar)');
      for (const jobId of activeJobs.values()) void this.queue.cancel(jobId).catch(() => undefined);
    };
    process.on('SIGINT', onSigint);

    try {
      if (!this.queueService.isOwner()) {
        console.log('La API está corriendo y procesa la cola: los videos se producen ahí (seguí el progreso en la app).');
      }
      if (this.queue.state().paused) {
        this.queue.resume();
        console.log('La cola estaba en pausa: se reanudó.');
      }

      let started: ProductionSummary[];
      if (flags.resume) {
        started = [await this.queue.retryProduction(flags.resume, flags.force ? 'script' : undefined)];
      } else {
        started = await this.queue.enqueue({ channelIds: [flags.channel], count: flags.count, topic: flags.topic });
      }
      started.forEach((p, i) => order.set(p.id, i + 1));
      for (const [i, p] of started.entries()) {
        console.log(`▶ ${flags.channel} · video ${i + 1} de ${started.length} · ${p.id}`);
      }
      const pending = buffered;
      buffered = null;
      pending.forEach(print);

      const results = await Promise.all(
        started.map(async (p) => {
          const r = await this.queue.waitFor(p.id);
          this.printResult(r, order.get(r.id) ?? 1, started.length);
          return r;
        }),
      );

      const ok = results.filter((r) => r.status === 'done').length;
      const total = results.reduce((sum, r) => sum + r.costUsd, 0);
      console.log(`\nListo: ${ok} de ${results.length} · costo total $${total.toFixed(4)}`);
      if (ok < results.length) process.exitCode = 1;
    } finally {
      sub.unsubscribe();
      process.off('SIGINT', onSigint);
    }
  }

  private prefix(productionId: string | undefined, order: Map<string, number>): string | null {
    if (!productionId) return null;
    const n = order.get(productionId);
    if (n === undefined) return null;
    return order.size > 1 ? `  [${n}/${order.size}] ` : '  ';
  }

  private printEvent(e: ServerEvent, order: Map<string, number>, activeJobs: Map<string, string>): void {
    switch (e.type) {
      case 'job': {
        const pid = e.job.productionId;
        if (!pid || !order.has(pid)) return;
        if (e.job.status === 'queued' || e.job.status === 'running') activeJobs.set(pid, e.job.id);
        else if (activeJobs.get(pid) === e.job.id) activeJobs.delete(pid);
        return;
      }
      case 'log': {
        const pre = this.prefix(e.entry.productionId, order);
        // warn/error lines already reach the terminal through Nest's logger.
        if (pre === null || e.entry.level !== 'info') return;
        const indent = e.entry.source === 'pipeline' ? '  ' : '';
        console.log(`${pre}${indent}${e.entry.message}`);
        return;
      }
      case 'progress': {
        const pre = this.prefix(e.productionId, order);
        if (pre === null || e.stage !== 'render' || !process.stdout.isTTY) return;
        process.stdout.write(`\r${pre}… ${STAGE_LABELS.render} ${Math.round(e.value * 100)}%   `);
        if (e.value >= 1) process.stdout.write('\n');
        return;
      }
      default:
        return;
    }
  }

  private printResult(r: ProductionSummary, n: number, total: number): void {
    const head = total > 1 ? `[${n}/${total}] ` : '';
    if (r.status !== 'done') {
      console.error(`  ✖ ${head}${r.title}: ${r.error ?? r.status}`);
      return;
    }
    const slug = this.channels.findById(r.channelId)?.slug ?? r.channelId;
    console.log(`  ✔ ${head}${r.title}`);
    console.log(`    ${join(paths.production(slug, r.id), 'render.mp4')}`);
    console.log(`    QA ${r.qaPassed ? 'aprobado' : 'con fallas (ver qa.json)'} · $${r.costUsd.toFixed(4)}`);
  }

  @Option({ flags: '-c, --channel <slug>', description: 'Slug del canal (por ejemplo mi-canal)', required: true })
  parseChannel(v: string): string {
    return v;
  }

  @Option({ flags: '-n, --count <n>', description: 'Cantidad de videos', defaultValue: 1 })
  parseCount(v: string): number {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1 || n > 50) throw new Error('--count debe estar entre 1 y 50');
    return n;
  }

  @Option({ flags: '-t, --topic <text>', description: 'Tema del guion (opcional)' })
  parseTopic(v: string): string {
    return v;
  }

  @Option({ flags: '-r, --resume <productionId>', description: 'Retomar una producción existente' })
  parseResume(v: string): string {
    return v;
  }

  @Option({ flags: '-f, --force', description: 'Con --resume: rehacer todas las etapas aunque no hayan cambiado' })
  parseForce(): boolean {
    return true;
  }
}
