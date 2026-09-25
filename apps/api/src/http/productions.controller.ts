import {
  BadGatewayException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type {
  Page,
  ProduceEstimate,
  ProduceRequest,
  ProductionDetail,
  ProductionSummary,
  QaCheckDto,
  StageKey,
} from '@hefesto/shared-types';
import { STAGE_ORDER } from '@hefesto/shared-types';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../config/env';
import {
  ChannelsRepository,
  CostEntriesRepository,
  type ProductionRow,
  ProductionsRepository,
  ProviderConfigsRepository,
  ScriptsRepository,
} from '../db/repositories';
import { sceneTimeline } from '../pipeline/timeline';
import { QUEUE_API, type QueueApi } from '../queue/queue.contract';
import { produceRequestSchema, retryProductionSchema } from './common/schemas';
import { ZodValidationPipe } from './common/zod-validation.pipe';

@Controller('productions')
export class ProductionsController {
  constructor(
    private readonly productions: ProductionsRepository,
    private readonly channels: ChannelsRepository,
    private readonly scripts: ScriptsRepository,
    private readonly costs: CostEntriesRepository,
    private readonly providerConfigs: ProviderConfigsRepository,
    @Optional() @Inject(QUEUE_API) private readonly queue: QueueApi | undefined,
  ) {}

  private requireQueue(): QueueApi {
    if (!this.queue) throw new BadGatewayException('La cola todavía no está disponible');
    return this.queue;
  }

  private toSummary(row: ProductionRow): ProductionSummary {
    const channel = this.channels.findById(row.channelId);
    const script = this.scripts.findById(row.scriptId);
    const hasRender = Boolean(row.renderPath) && existsSync(row.renderPath ?? '');
    return {
      id: row.id,
      channelId: row.channelId,
      channelName: channel?.name ?? row.channelId,
      title: script?.title ?? row.id,
      stage: row.stage,
      currentStep: (row.currentStep as StageKey | undefined) ?? undefined,
      status: row.status,
      progress: row.progress,
      durationMs: row.durationMs ?? undefined,
      qaPassed: row.stage === 'qa_passed' ? true : row.stage === 'qa_failed' ? false : undefined,
      costUsd: row.costUsd,
      thumbUrl: hasRender ? `/api/files/${row.id}/thumb.jpg` : undefined,
      videoUrl: hasRender ? `/api/files/${row.id}/render.mp4` : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      error: row.error ?? undefined,
    };
  }

  @Post('estimate')
  estimate(@Body(new ZodValidationPipe(produceRequestSchema)) body: ProduceRequest): Promise<ProduceEstimate> {
    return this.requireQueue().estimate(body);
  }

  @Post()
  enqueue(@Body(new ZodValidationPipe(produceRequestSchema)) body: ProduceRequest): Promise<ProductionSummary[]> {
    return this.requireQueue().enqueue(body);
  }

  @Get()
  list(
    @Query('channelId') channelId?: string,
    @Query('status') status?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ): Page<ProductionSummary> {
    let rows = channelId ? this.productions.listByChannel(channelId) : this.productions.listAll();
    if (status) rows = rows.filter((r) => r.status === status);
    rows = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const limit = limitStr ? Number(limitStr) : 20;
    const offset = offsetStr ? Number(offsetStr) : 0;
    const items = rows.slice(offset, offset + limit).map((r) => this.toSummary(r));
    return { items, total: rows.length };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ProductionDetail> {
    const row = this.productions.findById(id);
    if (!row) throw new NotFoundException(`Producción no encontrada: ${id}`);
    const channel = this.channels.findById(row.channelId);
    const script = this.scripts.findById(row.scriptId);
    if (!channel || !script) throw new NotFoundException(`Producción incompleta: ${id}`);

    const dir = paths.production(channel.slug, id);
    const summary = this.toSummary(row);

    let scenes: ProductionDetail['scenes'] = script.scenes.map((s) => ({ order: s.order, text: s.text, startMs: 0, endMs: 0 }));
    try {
      const words = JSON.parse(await readFile(join(dir, 'words.json'), 'utf8'));
      const voiceMs = row.durationMs ?? 0;
      const timeline = sceneTimeline(
        script.scenes.map((s) => s.text),
        words,
        voiceMs,
      );
      scenes = script.scenes.map((s, i) => ({
        order: s.order,
        text: s.text,
        startMs: timeline[i]?.startMs ?? 0,
        endMs: timeline[i]?.endMs ?? 0,
        imageUrl: `/api/files/${id}/scenes/${String(s.order).padStart(2, '0')}.jpg`,
      }));
    } catch {
      // Timings unavailable (stage not reached yet, or files were cleared) — keep the placeholders.
    }

    let qa: ProductionDetail['qa'];
    try {
      const parsed = JSON.parse(await readFile(join(dir, 'qa.json'), 'utf8')) as {
        passed: boolean;
        checks: QaCheckDto[];
      };
      qa = parsed;
    } catch {
      qa = undefined;
    }

    const costs = this.costs.listByProduction(id).map((c) => ({
      providerName: this.providerConfigs.findById(c.providerConfigId)?.name ?? c.providerConfigId,
      operation: c.operation,
      costUsd: c.costUsd,
      durationMs: c.durationMs,
    }));

    const stages = STAGE_ORDER.map((key) => ({
      key,
      state: stageState(row, key),
      durationMs: undefined as number | undefined,
    }));

    return { ...summary, script, scenes, qa, costs, stages, platform: channel.platform };
  }

  @Post(':id/retry')
  retry(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(retryProductionSchema)) body: { fromStage?: StageKey },
  ): Promise<ProductionSummary> {
    if (!this.productions.findById(id)) throw new NotFoundException(`Producción no encontrada: ${id}`);
    return this.requireQueue().retryProduction(id, body.fromStage);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    const row = this.productions.findById(id);
    if (!row) throw new NotFoundException(`Producción no encontrada: ${id}`);
    const channel = this.channels.findById(row.channelId);
    if (channel) {
      const dir = paths.production(channel.slug, id);
      await rm(dir, { recursive: true, force: true });
    }
    this.productions.delete(id);
  }
}

function stageState(
  row: ProductionRow,
  key: StageKey,
): 'pending' | 'running' | 'done' | 'skipped' | 'failed' {
  if (row.inputHashes[key]) return 'done';
  if (row.currentStep === key) return row.status === 'failed' ? 'failed' : 'running';
  return 'pending';
}
