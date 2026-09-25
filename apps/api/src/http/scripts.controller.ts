import { Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { GenerateScriptRequest, ScriptDto, ScriptPatch } from '@hefesto/shared-types';
import { ScriptsService } from '../ideas/scripts.service';
import { generateScriptRequestSchema, scriptPatchSchema } from './common/schemas';
import { ZodValidationPipe } from './common/zod-validation.pipe';

@Controller('scripts')
export class ScriptsController {
  constructor(private readonly scriptsService: ScriptsService) {}

  @Post('generate')
  generate(
    @Body(new ZodValidationPipe(generateScriptRequestSchema)) body: GenerateScriptRequest,
  ): Promise<ScriptDto> {
    return this.scriptsService.generate(body.channelId, body.ideaId, body.topic);
  }

  @Get(':id')
  get(@Param('id') id: string): ScriptDto {
    const script = this.scriptsService.get(id);
    if (!script) throw new NotFoundException(`Guion no encontrado: ${id}`);
    return script;
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body(new ZodValidationPipe(scriptPatchSchema)) body: ScriptPatch): ScriptDto {
    const updated = this.scriptsService.patch(id, body);
    if (!updated) throw new NotFoundException(`Guion no encontrado: ${id}`);
    return updated;
  }
}
