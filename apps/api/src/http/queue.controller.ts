import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Inject,
  Optional,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { JobDto, Lane, QueueState } from '@hefesto/shared-types';
import { QUEUE_API, type QueueApi } from '../queue/queue.contract';
import { laneConcurrencyPatchSchema, priorityPatchSchema } from './common/schemas';
import { ZodValidationPipe } from './common/zod-validation.pipe';

@Controller('queue')
export class QueueController {
  constructor(@Optional() @Inject(QUEUE_API) private readonly queue: QueueApi | undefined) {}

  private requireQueue(): QueueApi {
    if (!this.queue) throw new BadGatewayException('La cola todavía no está disponible');
    return this.queue;
  }

  @Get()
  state(): QueueState {
    return this.requireQueue().state();
  }

  @Post('pause')
  pause(): QueueState {
    return this.requireQueue().pause();
  }

  @Post('resume')
  resume(): QueueState {
    return this.requireQueue().resume();
  }

  @Post('jobs/:id/skip')
  skip(@Param('id') id: string): Promise<JobDto> {
    return this.requireQueue().skip(id);
  }

  @Post('jobs/:id/cancel')
  cancel(@Param('id') id: string): Promise<JobDto> {
    return this.requireQueue().cancel(id);
  }

  @Post('jobs/:id/retry')
  retry(@Param('id') id: string): Promise<JobDto> {
    return this.requireQueue().retry(id);
  }

  @Patch('jobs/:id')
  setPriority(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(priorityPatchSchema)) body: { priority: number },
  ): JobDto {
    return this.requireQueue().setPriority(id, body.priority);
  }

  @Patch('lanes/:lane')
  setLaneConcurrency(
    @Param('lane') lane: Lane,
    @Body(new ZodValidationPipe(laneConcurrencyPatchSchema)) body: { concurrency: number },
  ): QueueState {
    return this.requireQueue().setLaneConcurrency(lane, body.concurrency);
  }
}
