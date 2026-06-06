import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { isObservable } from 'rxjs';
import { lastValueFrom } from 'rxjs';

import { ALLOW_MISSING_TENANT_KEY, IS_PUBLIC_KEY } from './constants';
import type { AccessTokenPayload } from './interfaces/access-token-payload.interface';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ path?: string }>();
    const path = request.path ?? '';
    if (path === '/api/docs' || path === '/api/docs-json' || path.startsWith('/api/docs/')) {
      return true;
    }

    const activated = super.canActivate(context);
    const ok = await this.resolveGuardResult(activated);
    if (!ok) {
      return false;
    }

    const allowMissingTenant = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MISSING_TENANT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowMissingTenant) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{ user?: AccessTokenPayload }>();
    const user = req.user;
    if (!user?.tenant_id || typeof user.tenant_id !== 'string' || user.tenant_id.trim() === '') {
      throw new ForbiddenException('Missing tenant_id in access token');
    }
    return true;
  }

  private async resolveGuardResult(
    result: boolean | Promise<boolean> | import('rxjs').Observable<boolean>,
  ): Promise<boolean> {
    if (isObservable(result)) {
      return lastValueFrom(result);
    }
    return Promise.resolve(result as boolean | Promise<boolean>);
  }

  handleRequest<TUser>(err: Error | undefined, user: TUser | false): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException('Invalid or missing bearer token');
    }
    return user;
  }
}
