import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import type { RequestWithId } from '../http/request-with-id';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithId>();
    const startedAt = Date.now();

    return next.handle().pipe(
      finalize(() => {
        const res = http.getResponse<Response>();
        const durationMs = Date.now() - startedAt;
        this.logger.log(
          JSON.stringify({
            level: 'info',
            msg: 'http_request',
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl ?? req.url,
            statusCode: res.statusCode,
            durationMs,
          }),
        );
      }),
    );
  }
}
