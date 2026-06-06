import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AllowMissingTenant } from './decorators/allow-missing-tenant.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import type { AccessTokenPayload } from './interfaces/access-token-payload.interface';
import { UsersService } from '../users/users.service';
import { TenantContext } from './tenant-context.service';
import { resolveAppRole } from './utils/resolve-app-role';

@ApiTags('auth')
@ApiBearerAuth('access-token')
@Throttle({ default: { limit: 40, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
  ) {}

  @Get('me')
  @AllowMissingTenant()
  @ApiOperation({ summary: 'Authenticated user claims + perfil app (usuario)' })
  async getMe(@CurrentUser() user: AccessTokenPayload) {
    const tenantId = user.tenant_id ?? null;
    const profile =
      tenantId && typeof tenantId === 'string'
        ? await this.usersService.ensureFromJwt(user, tenantId)
        : null;

    return {
      data: {
        sub: user.sub,
        email: user.email ?? null,
        tenantId,
        appRole: resolveAppRole(user) ?? profile?.rol ?? null,
        profile: profile ? this.usersService.serializeUsuario(profile) : null,
      },
    };
  }

  @Get('tenant')
  @ApiOperation({ summary: 'Resolves tenant_id from JWT (fails if missing)' })
  getTenant() {
    return {
      data: {
        tenantId: this.tenantContext.getTenantId(),
      },
    };
  }

  @Get('admin-only')
  @Roles('admin')
  @ApiOperation({ summary: 'Example route restricted to admin (integration smoke)' })
  adminOnlyPing() {
    return { data: { ok: true } };
  }
}
