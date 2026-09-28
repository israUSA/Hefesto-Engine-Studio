import { Body, Controller, Delete, Get, Header, HttpException, Param, Post, Put, Query } from '@nestjs/common';
import type {
  FreeSpaceResult,
  GoogleAccountStatus,
  GoogleClientRequest,
  ProductionSummary,
  StorageOverview,
  StorageTargetRequest,
  UploadResult,
} from '@hefesto/shared-types';
import { z } from 'zod';
import { ZodValidationPipe } from '../http/common/zod-validation.pipe';
import { GoogleOAuthService } from './google-oauth.service';
import { StorageService } from './storage.service';

const targetSchema = z.discriminatedUnion('adapter', [
  z.object({ adapter: z.literal('google-drive') }),
  z.object({ adapter: z.literal('local-folder'), root: z.string().min(1) }),
  z.object({ adapter: z.literal('none') }),
]);
const productionIdsSchema = z.object({ productionIds: z.array(z.string().min(1)).max(500).optional() });
const googleClientSchema = z.object({ clientId: z.string().trim().min(10), clientSecret: z.string().trim().min(6) });

@Controller('storage')
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly google: GoogleOAuthService,
  ) {}

  @Get()
  overview(): Promise<StorageOverview> {
    return this.storage.overview();
  }

  @Put('target')
  setTarget(@Body(new ZodValidationPipe(targetSchema)) body: StorageTargetRequest): Promise<StorageOverview> {
    return this.storage.setTarget(body);
  }

  @Post('sync')
  sync(): Promise<StorageOverview> {
    return this.storage.sync();
  }

  @Post('upload')
  upload(@Body(new ZodValidationPipe(productionIdsSchema)) body: { productionIds?: string[] }): Promise<UploadResult> {
    return this.storage.upload(body.productionIds);
  }

  @Post('free')
  free(@Body(new ZodValidationPipe(productionIdsSchema)) body: { productionIds?: string[] }): Promise<FreeSpaceResult> {
    return this.storage.free(body.productionIds);
  }

  @Post('productions/:id/restore')
  restore(@Param('id') id: string): Promise<ProductionSummary> {
    return this.storage.restore(id);
  }

  // ── Google account ────────────────────────────────────────────────────

  @Get('google')
  googleStatus(): GoogleAccountStatus {
    return this.google.status();
  }

  @Put('google/client')
  setGoogleClient(@Body(new ZodValidationPipe(googleClientSchema)) body: GoogleClientRequest): Promise<GoogleAccountStatus> {
    return this.google.setClient(body.clientId, body.clientSecret);
  }

  @Post('google/connect')
  connectGoogle(): { authUrl: string } {
    return this.google.start();
  }

  /** Google sends the browser here (loopback); answers with a page the user can close. */
  @Get('google/callback')
  @Header('content-type', 'text/html; charset=utf-8')
  async googleCallback(@Query() query: { code?: string; state?: string; error?: string }): Promise<string> {
    try {
      const email = await this.google.callback(query);
      return page('Google Drive conectado', `${email ? `Cuenta: ${escapeHtml(email)}. ` : ''}Ya podés cerrar esta pestaña y volver a Hefesto.`);
    } catch (err) {
      const message = err instanceof HttpException || err instanceof Error ? err.message : String(err);
      return page('No se pudo conectar', escapeHtml(message));
    }
  }

  @Delete('google')
  disconnectGoogle(): Promise<GoogleAccountStatus> {
    return this.google.disconnect();
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title} · Hefesto</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:420px;padding:32px;border:1px solid #333;border-radius:12px;background:#1a1a1a}h1{font-size:20px;margin:0 0 12px}p{color:#aaa;line-height:1.5}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}
