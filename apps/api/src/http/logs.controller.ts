import { Controller, Get, Query } from '@nestjs/common';
import type { LogEntry, LogLevel } from '@hefesto/shared-types';
import { EventsService } from '../events/events.service';

@Controller('logs')
export class LogsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(
    @Query('limit') limitStr?: string,
    @Query('level') level?: LogLevel,
    @Query('source') source?: string,
  ): LogEntry[] {
    return this.events.recentLogs({ limit: limitStr ? Number(limitStr) : undefined, level, source });
  }
}
