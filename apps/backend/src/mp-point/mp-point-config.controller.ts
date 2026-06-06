import { Body, Controller, Delete, Get, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { MpPointConfigQueryDto, PatchMpPointConfigDto } from './dto/mp-point-config.dto';
import { MpPointConfigService } from './mp-point-config.service';

@ApiTags('config')
@ApiBearerAuth('access-token')
@Controller('config/mp-point')
export class MpPointConfigController {
  constructor(private readonly mpPointConfigService: MpPointConfigService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Configuraci├│n MP Point (sin secretos completos)',
    description: 'Paridad GET /api/configuracion/mp-point. Requiere facturador_pos.',
  })
  getConfig(@Query() query: MpPointConfigQueryDto, @CurrentUser() user: AccessTokenPayload) {
    const isAdmin = resolveAppRole(user) === 'admin';
    return this.mpPointConfigService.getPublicConfig(query.sucursal_id, isAdmin);
  }

  @Patch()
  @Roles('admin')
  @ApiOperation({
    summary: 'Guardar configuraci├│n MP Point',
    description: 'Paridad PATCH /api/configuracion/mp-point. Cifra access_token con ARCA_ENCRYPTION_KEY.',
  })
  patchConfig(@Body() dto: PatchMpPointConfigDto, @Query() query: MpPointConfigQueryDto) {
    return this.mpPointConfigService.patchConfig(dto, query.sucursal_id);
  }

  @Delete()
  @Roles('admin')
  @ApiOperation({
    summary: 'Eliminar configuraci├│n MP Point de la sucursal',
    description: 'Paridad DELETE /api/configuracion/mp-point.',
  })
  deleteConfig(@Query() query: MpPointConfigQueryDto) {
    return this.mpPointConfigService.deleteConfig(query.sucursal_id);
  }
}
