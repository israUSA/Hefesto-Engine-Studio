import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiError } from '@hefesto/shared-types';
import type { Response } from 'express';
import { ProviderError } from '../../providers';

/** Turns any thrown error into the `ApiError` JSON shape every non-2xx response uses. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno';
    let details: unknown;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        message = typeof b['message'] === 'string' ? b['message'] : exception.message;
        details = b['details'] ?? (Array.isArray(b['message']) ? b['message'] : undefined);
      }
    } else if (exception instanceof ProviderError) {
      statusCode = HttpStatus.BAD_GATEWAY;
      message = exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (statusCode >= 500) this.log.error(message, exception instanceof Error ? exception.stack : undefined);

    const body: ApiError = { statusCode, message, details };
    res.status(statusCode).json(body);
  }
}
