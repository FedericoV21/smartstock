import { randomUUID } from 'node:crypto';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { QueryFailedError } from 'typeorm';

import { DomainException } from '../errors/domain.exception';
import { defaultCodeForHttpStatus } from '../http/default-code-for-status';

type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
  meta: { requestId: string; timestamp: string };
};

function isDevelopment(config: ConfigService): boolean {
  const env = config.get<string>('NODE_ENV', 'development');
  return env === 'development' || env === 'dev';
}

function requestIdFrom(req: Request): string {
  const id = (req as Request & { id?: string }).id;
  if (typeof id === 'string' && id.length > 0) return id;
  const h = req.headers['x-request-id'];
  if (typeof h === 'string' && h.trim()) return h.trim().slice(0, 128);
  return randomUUID();
}

function normalizeDetails(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly config: ConfigService,
    @InjectPinoLogger(GlobalExceptionFilter.name)
    private readonly pino: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const isDev = isDevelopment(this.config);
    const meta = {
      requestId: requestIdFrom(req),
      timestamp: new Date().toISOString(),
    };

    const resolved = this.resolve(exception, isDev);
    const body: ApiErrorBody = {
      error: {
        code: resolved.code,
        message: resolved.message,
        details: resolved.details,
      },
      meta,
    };

    this.logResolved(resolved.status, resolved, meta.requestId, exception);

    if (!res.headersSent) {
      res.status(resolved.status).json(body);
    }
  }

  private logResolved(
    status: number,
    resolved: { code: string; message: string },
    requestId: string,
    exception: unknown,
  ): void {
    const ctx = { requestId, code: resolved.code, statusCode: status };
    if (status >= 500) {
      this.pino.error({ err: exception, ...ctx }, resolved.message);
    } else if (status >= 400) {
      this.pino.warn(ctx, resolved.message);
    }
  }

  private resolve(
    exception: unknown,
    isDev: boolean,
  ): {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
  } {
    if (exception instanceof DomainException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: { ...exception.details },
      };
    }

    if (exception instanceof QueryFailedError) {
      const driver = (exception as QueryFailedError & { driverError?: { code?: string } })
        .driverError;
      if (driver?.code === '23505') {
        return {
          status: HttpStatus.CONFLICT,
          code: 'DUPLICATE_RESOURCE',
          message: 'Resource already exists',
          details: isDev ? { pgCode: driver.code } : {},
        };
      }
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception, isDev);
    }

    if (exception instanceof Error) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: isDev
          ? exception.message
          : 'An unexpected error occurred. Please try again later.',
        details: isDev ? { stack: exception.stack ?? '' } : {},
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again later.',
      details: {},
    };
  }

  private fromHttpException(
    exception: HttpException,
    isDev: boolean,
  ): { status: number; code: string; message: string; details: Record<string, unknown> } {
    const status = exception.getStatus();
    const raw = exception.getResponse();
    let code = defaultCodeForHttpStatus(status);
    let message = exception.message;
    let details: Record<string, unknown> = {};

    if (typeof raw === 'string') {
      message = raw;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;

      if (typeof obj.code === 'string') code = obj.code;

      if (Array.isArray(obj.message)) {
        message = 'Validation failed';
        code = 'VALIDATION_ERROR';
        details = { fields: obj.message };
      } else if (typeof obj.message === 'string') {
        message = obj.message;
      }

      const nested = normalizeDetails(obj.details);
      if (nested) details = { ...details, ...nested };
    }

    if (isDev && exception.cause instanceof Error) {
      details = { ...details, cause: exception.cause.message };
    }

    return { status, code, message, details };
  }
}
