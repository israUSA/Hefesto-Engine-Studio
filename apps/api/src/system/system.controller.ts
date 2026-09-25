import { Controller, Get } from '@nestjs/common';
import type { SystemInfo, Telemetry } from '@hefesto/shared-types';
import { SystemInfoService } from './system-info.service';
import { TelemetryService } from './telemetry.service';

@Controller('system')
export class SystemController {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly info: SystemInfoService,
  ) {}

  @Get('telemetry')
  getTelemetry(): Telemetry {
    return (
      this.telemetry.current() ?? {
        cpu: { pct: 0, threads: 0 },
        memory: { usedMb: 0, totalMb: 0 },
        disk: { freeGb: 0, totalGb: 0, path: '' },
        capturedAt: new Date().toISOString(),
      }
    );
  }

  @Get('info')
  getInfo(): Promise<SystemInfo> {
    return this.info.get();
  }
}
