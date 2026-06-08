import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { ConfigCajasService } from './config-cajas.service';
import { CreateCajaDto, ListCajasQueryDto, PatchCajaDto } from './dto/config-cajas.dto';
import { ActivatePlanDto, SetIaIlimitadaDto } from './dto/plan.dto';
import { PatchPosPrefsDto, PosPrefsQueryDto } from './dto/pos-prefs.dto';
import { PlanService } from './plan.service';
import { PosPrefsService } from './pos-prefs.service';
import { resolveAppRole } from '../auth/utils/resolve-app-role';

@ApiTags('config')
@ApiBearerAuth('access-token')
@Controller('config')
export class ConfigExtendedController {
  constructor(
    private readonly configCajas: ConfigCajasService,
    private readonly planService: PlanService,
    private readonly posPrefsService: PosPrefsService,
  ) {}

  @Get('cajas')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar cajas por sucursal (paridad GET /api/configuracion/cajas)' })
  listCajas(@CurrentUser() user: AccessTokenPayload, @Query() query: ListCajasQueryDto) {
    return this.configCajas.list(user, query.sucursal_id);
  }

  @Post('cajas')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear caja' })
  createCaja(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateCajaDto) {
    return this.configCajas.create(user, dto);
  }

  @Patch('cajas/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Editar caja' })
  patchCaja(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchCajaDto,
  ) {
    return this.configCajas.patch(user, id, dto);
  }

  @Delete('cajas/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar caja sin historial' })
  deleteCaja(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.configCajas.delete(user, id);
  }

  @Post('cajas/:id/forzar-cierre')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cierre administrativo de turno abierto' })
  forzarCierre(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.configCajas.forzarCierre(user, id);
  }

  @Get('plan')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Plan y módulos del tenant' })
  getPlan() {
    return this.planService.getPlan();
  }

  @Post('plan')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar plan base o completo' })
  activatePlan(@Body() dto: ActivatePlanDto) {
    return this.planService.activatePlan(dto.plan);
  }

  @Get('ia-ilimitada')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Origen IA ilimitada (plan intermedio)' })
  getIaIlimitada() {
    return this.planService.getIaIlimitada();
  }

  @Post('ia-ilimitada')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Elegir origen IA ilimitada' })
  setIaIlimitada(@Body() dto: SetIaIlimitadaDto) {
    return this.planService.setIaIlimitada(dto.ia_ilimitada_origen);
  }

  @Get('pos-prefs')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Preferencias POS efectivas' })
  getPosPrefs(@Query() query: PosPrefsQueryDto) {
    return this.posPrefsService.get(query.for_config === '1', query.sucursal_id ?? null);
  }

  @Patch('pos-prefs')
  @Roles('admin')
  @ApiOperation({ summary: 'Actualizar preferencias POS tenant o sucursal' })
  patchPosPrefs(@Body() dto: PatchPosPrefsDto, @CurrentUser() user: AccessTokenPayload) {
    return this.posPrefsService.patch(dto, resolveAppRole(user));
  }

  @Get('pos-prefs/balanza-sucursales')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Matriz balanza por sucursal' })
  listBalanzaSucursales() {
    return this.posPrefsService.listBalanzaSucursales();
  }
}
