import { Injectable, Logger } from '@nestjs/common';
import type { LogEntry, LogLevel, ServerEvent } from '@hefesto/shared-types';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Subject } from 'rxjs';
import { paths } from '../config/env';

const MAX_LOGS = 2000;

/**
 * Single bus for live events (queue, jobs, progress, logs, telemetry).
 * The WebSocket gateway forwards every event to connected clients.
 */
@Injectable()
export class EventsService {
  readonly events$ = new Subject<ServerEvent>();
  private readonly logs: LogEntry[] = [];
  private nextId = 1;
  private readonly nest = new Logger('Hefesto');

  emit(event: ServerEvent): void {
    this.events$.next(event);
  }

  log(
    level: LogLevel,
    source: string,
    message: string,
    ctx: { productionId?: string; jobId?: string } = {},
  ): LogEntry {
    const entry: LogEntry = { id: this.nextId++, at: new Date().toISOString(), level, source, message, ...ctx };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
    this.emit({ type: 'log', entry });
    if (level === 'error') this.nest.error(`[${source}] ${message}`);
    else if (level === 'warn') this.nest.warn(`[${source}] ${message}`);
    void this.persist(entry);
    return entry;
  }

  recentLogs(opts: { limit?: number; level?: LogLevel; source?: string } = {}): LogEntry[] {
    const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const min = opts.level ? order.indexOf(opts.level) : 0;
    return this.logs
      .filter((l) => order.indexOf(l.level) >= min && (!opts.source || l.source === opts.source))
      .slice(-(opts.limit ?? 500));
  }

  private async persist(entry: LogEntry): Promise<void> {
    try {
      await mkdir(paths.logs(), { recursive: true });
      const day = entry.at.slice(0, 10);
      await appendFile(join(paths.logs(), `hefesto-${day}.log`), `${JSON.stringify(entry)}\n`);
    } catch {
      // Logging must never break the pipeline.
    }
  }
}
