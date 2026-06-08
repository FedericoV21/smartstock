import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { ListNexusTenantsQueryDto } from './dto/list-nexus-tenants-query.dto';
import { NexusLoginDto } from './dto/nexus-login.dto';
import { PatchNexusTenantDto } from './dto/patch-nexus-tenant.dto';
import { NexusDashboardAuthService } from './nexus-dashboard-auth.service';
import { NexusDashboardTenantsService } from './nexus-dashboard-tenants.service';
import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  NEXUS_DASHBOARD_COOKIE,
  nexusDashboardCookieOptions,
} from './utils/auth-cookie.util';

@ApiTags('nexus-dashboard')
@Controller('nexus-dashboard')
@Public()
export class NexusDashboardController {
  constructor(
    private readonly authService: NexusDashboardAuthService,
    private readonly tenantsService: NexusDashboardTenantsService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login panel interno Nexus (cookie HMAC)' })
  login(@Body() dto: NexusLoginDto, @Res({ passthrough: true }) res: Response) {
    const token = this.authService.assertPassword(dto.password);
    res.setHeader(
      'Set-Cookie',
      buildSetCookieHeader(NEXUS_DASHBOARD_COOKIE, token, nexusDashboardCookieOptions()),
    );
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cierra sesión Nexus (borra cookie)' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Set-Cookie', buildClearCookieHeader(NEXUS_DASHBOARD_COOKIE));
    return { ok: true };
  }

  @Get('session')
  @ApiOperation({ summary: 'Verifica sesión Nexus por cookie' })
  session(@Req() req: Request) {
    return { ok: this.authService.isSessionValid(req) };
  }

  @Get('tenants')
  @ApiOperation({ summary: 'Lista tenants (admin creador) para panel Nexus' })
  listTenants(@Req() req: Request, @Query() query: ListNexusTenantsQueryDto) {
    this.authService.assertSession(req);
    return this.tenantsService.list(query);
  }

  @Patch('tenants')
  @ApiOperation({ summary: 'Actualiza plan, IA, mensualidad o facturación Ginkgo' })
  patchTenant(@Req() req: Request, @Body() dto: PatchNexusTenantDto) {
    this.authService.assertSession(req);
    return this.tenantsService.patch(dto);
  }
}
