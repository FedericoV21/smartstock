import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AllowMissingTenant } from './decorators/allow-missing-tenant.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { CambiarTenantDto } from './dto/cambiar-tenant.dto';
import type { AccessTokenPayload } from './interfaces/access-token-payload.interface';
import { SuperAdminTenantService } from './super-admin-tenant.service';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('admin')
export class AdminController {
  constructor(private readonly superAdminTenant: SuperAdminTenantService) {}

  @Get('tenants-accesibles')
  @AllowMissingTenant()
  @ApiOperation({ summary: 'Lista tenants en whitelist del super-admin' })
  async listTenantsAccesibles(@CurrentUser() user: AccessTokenPayload) {
    const tenants = await this.superAdminTenant.listAccessibleTenants(user.sub);
    return { tenants };
  }

  @Post('cambiar-tenant')
  @AllowMissingTenant()
  @HttpCode(200)
  @ApiOperation({ summary: 'Cambia tenant_contexto_id del super-admin (auditoría en log)' })
  async cambiarTenant(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CambiarTenantDto,
  ) {
    const tenantId =
      dto.tenant_id === undefined ? null : dto.tenant_id;
    return this.superAdminTenant.switchTenantContext(user.sub, tenantId);
  }
}
