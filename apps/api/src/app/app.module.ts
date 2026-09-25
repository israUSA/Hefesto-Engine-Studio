import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { EventsModule } from '../events/events.module';
import { HttpApiModule } from '../http/http-api.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { QueueModule } from '../queue/queue.module';
import { SecretsModule } from '../secrets/secrets.module';
import { SystemModule } from '../system/system.module';

@Module({
  imports: [SecretsModule, EventsModule, DbModule, PipelineModule, QueueModule, SystemModule, HttpApiModule],
})
export class AppModule {}
