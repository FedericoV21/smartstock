import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ path?: string }>();
    const path = request.path ?? '';
    if (path === '/api/docs' || path === '/api/docs-json' || path.startsWith('/api/docs/')) {
      return true;
    }
    if (path.startsWith('/api/v1/internal/')) {
      return true;
    }
    return super.canActivate(context);
  }

  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req['headers'] as Record<string, unknown> | undefined;
    const forwarded = headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const ip = forwarded.split(',')[0]?.trim();
      if (ip) {
        return Promise.resolve(ip);
      }
    }
    return super.getTracker(req);
  }
}
