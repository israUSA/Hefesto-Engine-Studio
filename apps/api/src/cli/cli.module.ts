import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { EventsModule } from '../events/events.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { QueueModule } from '../queue/queue.module';
import { SecretsModule } from '../secrets/secrets.module';
import { KeysCommand } from './keys.command';
import { ProduceCommand } from './produce.command';
import { SetupCommand } from './setup.command';

@Module({
  // The queue starts lazily (first enqueue), so `setup` and `keys` never run jobs.
  imports: [SecretsModule, EventsModule, DbModule, PipelineModule, QueueModule.register({ autoStart: false })],
  providers: [ProduceCommand, SetupCommand, KeysCommand],
})
export class CliModule {}
