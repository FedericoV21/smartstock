import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('metrics')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'KPIs del dashboard (mes en curso)',
    description:
      'Paridad GET /api/dashboard/metricas. Admin y visor. Valor inventario en sucursales operables del usuario.',
  })
  getMetrics(@CurrentUser() user: AccessTokenPayload) {
    return this.service.getMetrics(user);
  }
}
