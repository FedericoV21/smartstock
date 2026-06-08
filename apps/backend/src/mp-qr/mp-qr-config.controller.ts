import { Body, Controller, Delete, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import {
  MpQrConfigQueryDto,
  PatchMpQrConfigDto,
} from './dto/mp-qr-config.dto';
import { MpQrConfigService } from './mp-qr-config.service';

@ApiTags('config')
@ApiBearerAuth('access-token')
@Controller('config/mp-qr')
export class MpQrConfigController {
  constructor(private readonly mpQrConfigService: MpQrConfigService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Configuración MP QR (sin secretos completos)',
    description: 'Paridad GET /api/configuracion/mp-qr.',
  })
  getConfig(@Query() query: MpQrConfigQueryDto, @CurrentUser() user: AccessTokenPayload) {
    const isAdmin = resolveAppRole(user) === 'admin';
    return this.mpQrConfigService.getPublicConfig(query.sucursal_id, isAdmin);
  }

  @Patch()
  @Roles('admin')
  @ApiOperation({
    summary: 'Guardar configuración MP QR',
    description: 'Paridad PATCH /api/configuracion/mp-qr.',
  })
  patchConfig(@Body() dto: PatchMpQrConfigDto, @Query() query: MpQrConfigQueryDto) {
    return this.mpQrConfigService.patchConfig(dto, query.sucursal_id);
  }

  @Delete()
  @Roles('admin')
  @ApiOperation({
    summary: 'Eliminar configuración MP QR de la sucursal',
    description: 'Paridad DELETE /api/configuracion/mp-qr.',
  })
  deleteConfig(@Query() query: MpQrConfigQueryDto) {
    return this.mpQrConfigService.deleteConfig(query.sucursal_id);
  }
}
