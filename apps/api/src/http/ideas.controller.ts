import { Body, Controller, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { GenerateIdeasRequest, IdeaDto } from '@hefesto/shared-types';
import { IdeasRepository } from '../db/repositories';
import { IdeasService } from '../ideas/ideas.service';
import { generateIdeasRequestSchema, ideaPatchSchema } from './common/schemas';
import { ZodValidationPipe } from './common/zod-validation.pipe';

@Controller('ideas')
export class IdeasController {
  constructor(
    private readonly ideasService: IdeasService,
    private readonly ideas: IdeasRepository,
  ) {}

  @Post('generate')
  generate(@Body(new ZodValidationPipe(generateIdeasRequestSchema)) body: GenerateIdeasRequest): Promise<IdeaDto[]> {
    return this.ideasService.generate(body.channelId, body.count, body.hint);
  }

  @Patch(':id')
  patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ideaPatchSchema)) body: { status: IdeaDto['status'] },
  ): IdeaDto {
    const updated = this.ideas.updateStatus(id, body.status);
    if (!updated) throw new NotFoundException(`Idea no encontrada: ${id}`);
    return updated;
  }
}
