import { Controller, Get } from '@nestjs/common';
import type { ChannelTemplateDto } from '@hefesto/shared-types';
import { CHANNEL_TEMPLATES } from '../db/channel-templates';

@Controller('channel-templates')
export class ChannelTemplatesController {
  @Get()
  list(): ChannelTemplateDto[] {
    return CHANNEL_TEMPLATES;
  }
}
