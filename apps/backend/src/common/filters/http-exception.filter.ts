import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import type { RequestWithId } from '../http/request-with-id';

type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details: unknown;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();
    const nodeEnv = process.env.NODE_ENV ?? 'development';

    const { status, body } = this.mapException(exception, nodeEnv);
    const payload: ApiErrorBody = {
      error: body,
      meta: {
        requestId: request.requestId,
        timestamp: new Date().toISOString(),
      },
    };

    this.logger.error(
      JSON.stringify({
        level: 'error',
        msg: 'http_error',
        requestId: request.requestId,
        path: request.originalUrl ?? request.url,
        statusCode: status,
        code: body.code,
        message: body.message,
        ...(nodeEnv === 'development' && exception instanceof Error
          ? { stack: exception.stack }
          : {}),
      }),
    );

    response.status(status).json(payload);
  }

  private normalizeMessage(message: unknown, fallback: string): string {
    if (typeof message === 'string') {
      return message;
    }
    if (Array.isArray(message)) {
      return message.map(String).join(', ');
    }
    if (message !== undefined && message !== null) {
      return String(message);
    }
    return fallback;
  }

  private mapException(
    exception: unknown,
    nodeEnv: string,
  ): { status: number; body: ApiErrorBody['error'] } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string'
          ? raw
          : typeof raw === 'object' && raw !== null && 'message' in raw
            ? this.normalizeMessage((raw as { message?: unknown }).message, exception.message)
            : exception.message;

      const details =
        typeof raw === 'object' && raw !== null && 'error' in raw
          ? (raw as { error?: unknown }).error
          : typeof raw === 'object' && raw !== null
            ? raw
            : {};

      return {
        status,
        body: {
          code: `HTTP_${status}`,
          message,
          details,
        },
      };
    }

    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    return {
      status,
      body: {
        code: 'INTERNAL_ERROR',
        message:
          (nodeEnv === 'development' || nodeEnv === 'test') && exception instanceof Error
            ? exception.message
            : 'Error interno del servidor',
        details: {},
      },
    };
  }
}
