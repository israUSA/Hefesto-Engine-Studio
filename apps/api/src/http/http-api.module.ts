import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DbModule } from '../db/db.module';
import { IdeasModule } from '../ideas/ideas.module';
import { MediaModule } from '../media/media.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { QueueModule } from '../queue/queue.module';
import { BindingsController } from './bindings.controller';
import { BoardController } from './board.controller';
import { ChannelTemplatesController } from './channel-templates.controller';
import { ChannelsController } from './channels.controller';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { FilesController } from './files.controller';
import { IdeasController } from './ideas.controller';
import { LogsController } from './logs.controller';
import { ProductionsController } from './productions.controller';
import { ProvidersController } from './providers.controller';
import { QueueController } from './queue.controller';
import { ScriptsController } from './scripts.controller';
import { SecretsController } from './secrets.controller';

/** REST controllers under /api (see libs/shared/types/src/lib/api.ts). Owner: REST agent. */
@Module({
  imports: [DbModule, PipelineModule, MediaModule, IdeasModule, QueueModule],
  controllers: [
    ChannelsController,
    ChannelTemplatesController,
    BoardController,
    IdeasController,
    ScriptsController,
    ProductionsController,
    QueueController,
    ProvidersController,
    BindingsController,
    SecretsController,
    LogsController,
    FilesController,
  ],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class HttpApiModule {}
