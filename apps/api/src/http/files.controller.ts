import { Controller, Get, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';
import type { Request, Response } from 'express';
import { paths } from '../config/env';
import { ChannelsRepository, ProductionsRepository } from '../db/repositories';

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ass': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
};

/**
 * Serves production output files (and voice previews) with HTTP Range support
 * for video/audio seeking. Every path is resolved and checked against its
 * base folder before opening — no `..`, no absolute path, no drive letter.
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly channels: ChannelsRepository,
    private readonly productions: ProductionsRepository,
  ) {}

  @Get(':productionId/*')
  async stream(
    @Param('productionId') productionId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Express/path-to-regexp wildcard capture: a named `*path` param comes back as an array
    // of segments on newer path-to-regexp, and as a single string ("0") on older versions.
    const wildcardParam = (req.params as Record<string, unknown>)['path'] ?? (req.params as Record<string, unknown>)['0'];
    const relFile = Array.isArray(wildcardParam) ? wildcardParam.join('/') : (wildcardParam as string | undefined);
    const baseDir = this.resolveBaseDir(productionId);
    if (!baseDir) throw new NotFoundException(`No se encontró: ${productionId}`);

    const filePath = this.resolveSafePath(baseDir, relFile);
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      throw new NotFoundException(`Archivo no encontrado: ${relFile}`);
    }

    const stat = statSync(filePath);
    const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const range = req.headers.range;
    if (!range) {
      res.setHeader('Content-Length', String(stat.size));
      res.status(200);
      this.pipeSafely(filePath, {}, res);
      return;
    }

    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
      return;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    this.pipeSafely(filePath, { start, end }, res);
  }

  /** `.pipe()` never forwards source read errors to the destination — without this, a file
   *  that disappears mid-stream would crash the process with an unhandled 'error' event. */
  private pipeSafely(filePath: string, range: { start?: number; end?: number }, res: Response): void {
    const stream = createReadStream(filePath, range);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    stream.pipe(res);
  }

  private resolveBaseDir(productionId: string): string | undefined {
    if (productionId === 'previews') return paths.previews();
    const production = this.productions.findById(productionId);
    if (!production) return undefined;
    const channel = this.channels.findById(production.channelId);
    if (!channel) return undefined;
    return paths.production(channel.slug, productionId);
  }

  /** Rejects `..`, absolute paths and drive letters before resolving inside `baseDir`. */
  private resolveSafePath(baseDir: string, relFile: string | undefined): string | undefined {
    if (!relFile) return undefined;
    const decoded = decodeURIComponent(relFile);
    if (decoded.includes('..') || isAbsolute(decoded) || /^[a-zA-Z]:/.test(decoded)) return undefined;

    const base = resolve(baseDir);
    const target = resolve(join(base, decoded));
    if (target !== base && !target.startsWith(base + sep)) return undefined;
    return target;
  }
}
