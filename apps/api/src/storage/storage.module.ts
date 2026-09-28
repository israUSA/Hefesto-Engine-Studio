import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { QueueModule } from '../queue/queue.module';
import { GoogleOAuthService } from './google-oauth.service';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

/** Drive / storage view and the Google account (docs/06). Needs EventsModule and SecretsModule (global). */
@Module({
  imports: [DbModule, PipelineModule, QueueModule],
  controllers: [StorageController],
  providers: [StorageService, GoogleOAuthService],
})
export class StorageModule {}
