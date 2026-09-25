import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { BibleService } from './bible.service';

@Module({
  imports: [DbModule],
  providers: [BibleService],
  exports: [BibleService],
})
export class BibleModule {}
