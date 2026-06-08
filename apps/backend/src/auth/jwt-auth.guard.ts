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

import { ALLOW_MISSING_TENANT_KEY, IS_PUBLIC_KEY, TENANT_ID_HEADER } from './constants';
import type { AccessTokenPayload } from './interfaces/access-token-payload.interface';
import { SuperAdminTenantService } from './super-admin-tenant.service';

type AuthedRequest = {
  path?: string;
  user?: AccessTokenPayload;
  header?: (name: string) => string | undefined;
};

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly superAdminTenant: SuperAdminTenantService,
  ) {
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

    const request = context.switchToHttp().getRequest<AuthedRequest>();
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

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user?.sub) {
      throw new UnauthorizedException('Invalid or missing bearer token');
    }

    const usuario = await this.superAdminTenant.findUsuarioById(user.sub);
    if (usuario) {
      user.tenant_home_id = usuario.tenantId;
      user.es_super_admin = usuario.esSuperAdmin;
    }

    const effective = await this.superAdminTenant.resolveEffectiveTenantId({
      userId: user.sub,
      jwtTenantId: user.tenant_id,
      headerTenantId: req.header?.(TENANT_ID_HEADER),
    });

    if (effective) {
      user.tenant_id = effective;
    }

    if (!allowMissingTenant) {
      if (!user.tenant_id || typeof user.tenant_id !== 'string' || user.tenant_id.trim() === '') {
        throw new ForbiddenException('Missing tenant_id in access token');
      }
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
