import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { SystemController } from './system.controller';
import { SystemInfoService } from './system-info.service';
import { TelemetryService } from './telemetry.service';

/** Telemetry (GPU, CPU, RAM, disk) and system info. Owner: REST agent. */
@Module({
  imports: [MediaModule],
  controllers: [SystemController],
  providers: [TelemetryService, SystemInfoService],
  exports: [TelemetryService],
})
export class SystemModule {}
