import { type DynamicModule, Module } from '@nestjs/common';
import { DB, DbModule, type DbInstance } from '../db/db.module';
import { MediaModule } from '../media/media.module';
import { DbBindingSource } from '../pipeline/adapters/db-binding-source';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ProductionService } from '../pipeline/production.service';
import { PROVIDER_REGISTRY, type ProviderRegistry } from '../providers';
import { QueueEstimator } from './estimator';
import { JobsStore } from './jobs.store';
import { ProviderLaneResolver } from './lane-resolver';
import { ProductionSummaryReader } from './production-summary';
import { QUEUE_API } from './queue.contract';
import { QueueService } from './queue.service';
import { LANE_RESOLVER, QUEUE_OPTIONS, type QueueOptions, STAGE_RUNNER } from './queue.tokens';

/**
 * Persistent job queue (lanes gpu/net/cpu) and the workers that run pipeline stages.
 * Needs EventsModule (global) in the root module.
 *
 * Imported as is (API), the workers start on application bootstrap. The CLI imports
 * `QueueModule.register({ autoStart: false })`: the queue then starts on its first call,
 * so commands like `setup` or `keys` never touch it.
 */
@Module({
  imports: [DbModule, PipelineModule, MediaModule],
  providers: [
    JobsStore,
    ProductionSummaryReader,
    { provide: STAGE_RUNNER, useExisting: ProductionService },
    { provide: LANE_RESOLVER, useClass: ProviderLaneResolver },
    {
      provide: QueueEstimator,
      useFactory: (registry: ProviderRegistry, bindings: DbBindingSource, db: DbInstance) =>
        new QueueEstimator(registry, bindings, db),
      inject: [PROVIDER_REGISTRY, DbBindingSource, DB],
    },
    QueueService,
    { provide: QUEUE_API, useExisting: QueueService },
  ],
  exports: [QUEUE_API, QueueService, ProductionSummaryReader],
})
export class QueueModule {
  static register(options: Partial<QueueOptions>): DynamicModule {
    return { module: QueueModule, providers: [{ provide: QUEUE_OPTIONS, useValue: options }] };
  }
}
