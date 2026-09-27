import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { SUBTITLE_FONTS, type FontDto } from '@hefesto/shared-types';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../config/env';

const fontPath = (file: string) => join(env.dataDir, 'fonts', file);

/**
 * Subtitle fonts the renderer can use (data/fonts, passed to libass as `fontsdir`).
 * Files are served only when they are in the SUBTITLE_FONTS catalog, so no path from
 * the request ever reaches the filesystem.
 */
@Controller('fonts')
export class FontsController {
  @Get()
  list(): FontDto[] {
    return SUBTITLE_FONTS.filter((f) => existsSync(fontPath(f.file))).map((f) => ({
      family: f.family,
      url: `/api/fonts/${encodeURIComponent(f.file)}`,
    }));
  }

  @Get(':file')
  file(@Param('file') file: string, @Res() res: Response): void {
    const font = SUBTITLE_FONTS.find((f) => f.file === file);
    if (!font || !existsSync(fontPath(font.file))) throw new NotFoundException(`Fuente no encontrada: ${file}`);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(fontPath(font.file), { headers: { 'Content-Type': 'font/ttf' } });
  }
}
