import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY, ROLES_KEY } from './constants';
import type { AccessTokenPayload } from './interfaces/access-token-payload.interface';
import { resolveAppRole } from './utils/resolve-app-role';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ path?: string; user?: AccessTokenPayload }>();
    const path = request.path ?? '';
    if (path === '/api/docs' || path === '/api/docs-json' || path.startsWith('/api/docs/')) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) {
      return true;
    }

    const user = request.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    const actual = resolveAppRole(user);
    if (!actual || !required.includes(actual)) {
      throw new ForbiddenException('Insufficient role for this operation');
    }
    return true;
  }
}
