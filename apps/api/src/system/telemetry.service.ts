import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Telemetry } from '@hefesto/shared-types';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { parse } from 'node:path';
import { promisify } from 'node:util';
import { env } from '../config/env';
import { EventsService } from '../events/events.service';

const execFileAsync = promisify(execFile);
const SAMPLE_MS = 2000;

interface CpuSnapshot {
  idle: number;
  total: number;
}

function snapshotCpus(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((a, b) => a + b, 0);
  }
  return { idle, total };
}

/** Samples CPU/RAM/disk/GPU every 2 s and broadcasts a `telemetry` event. */
@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TelemetryService.name);
  private timer?: NodeJS.Timeout;
  private lastCpu = snapshotCpus();
  /** undefined = not probed yet; false = probed once and absent, don't retry every tick. */
  private nvidiaAvailable: boolean | undefined;
  private last?: Telemetry;

  constructor(private readonly events: EventsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sample(), SAMPLE_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  current(): Telemetry | undefined {
    return this.last;
  }

  private async sample(): Promise<void> {
    try {
      const telemetry = await this.capture();
      this.last = telemetry;
      this.events.emit({ type: 'telemetry', telemetry });
    } catch (err) {
      this.log.debug(`No se pudo capturar telemetría: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async capture(): Promise<Telemetry> {
    const now = snapshotCpus();
    const idleDelta = now.idle - this.lastCpu.idle;
    const totalDelta = now.total - this.lastCpu.total;
    this.lastCpu = now;
    const pct = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 1000) / 10 : 0;

    const [disk, gpu] = await Promise.all([this.diskUsage(), this.gpuUsage()]);

    return {
      cpu: { pct, threads: cpus().length },
      memory: { usedMb: Math.round((totalmem() - freemem()) / 1e6), totalMb: Math.round(totalmem() / 1e6) },
      disk,
      gpu,
      capturedAt: new Date().toISOString(),
    };
  }

  private async diskUsage(): Promise<Telemetry['disk']> {
    const root = parse(env.home).root || env.home;
    try {
      const stats = await fs.statfs(root);
      return {
        freeGb: Math.round((stats.bfree * stats.bsize) / 1e9),
        totalGb: Math.round((stats.blocks * stats.bsize) / 1e9),
        path: root,
      };
    } catch {
      return { freeGb: 0, totalGb: 0, path: root };
    }
  }

  private async gpuUsage(): Promise<Telemetry['gpu']> {
    if (this.nvidiaAvailable === false) return undefined;
    try {
      const { stdout } = await execFileAsync(
        'nvidia-smi',
        ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
        { timeout: 1500 },
      );
      this.nvidiaAvailable = true;
      const [name, util, temp, used, total] = stdout.trim().split(',').map((s) => s.trim());
      return {
        name,
        utilPct: Number(util),
        tempC: Number(temp),
        vramUsedMb: Number(used),
        vramTotalMb: Number(total),
      };
    } catch {
      this.nvidiaAvailable = false;
      return undefined;
    }
  }
}
