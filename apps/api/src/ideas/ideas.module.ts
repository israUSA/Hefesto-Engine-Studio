import { Module } from '@nestjs/common';
import { BibleModule } from '../bible/bible.module';
import { DbModule } from '../db/db.module';
import { LocalBibleLookup } from '../pipeline/adapters/bible-lookup';
import { PipelineModule } from '../pipeline/pipeline.module';
import { IdeasService } from './ideas.service';
import { ScriptsService } from './scripts.service';

/** Idea and (pre-production, draft/approved) script generation for the kanban board. */
@Module({
  imports: [DbModule, BibleModule, PipelineModule],
  providers: [IdeasService, ScriptsService, LocalBibleLookup],
  exports: [IdeasService, ScriptsService],
})
export class IdeasModule {}
