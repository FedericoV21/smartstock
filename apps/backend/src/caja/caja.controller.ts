import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { CajaService } from './caja.service';
import {
  CajaCierreZQueryDto,
  CajaDisponiblesQueryDto,
  CajaTurnoActualQueryDto,
  CajaTurnosHistorialQueryDto,
} from './dto/caja-query.dto';
import { AbrirTurnoDto, CerrarTurnoDto } from './dto/turno.dto';

@ApiTags('caja')
@ApiBearerAuth('access-token')
@Controller('caja')
export class CajaController {
  constructor(private readonly cajaService: CajaService) {}

  @Get('disponibles')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Cajas disponibles para el usuario',
    description: 'Paridad GET /api/caja/disponibles',
  })
  getDisponibles(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: CajaDisponiblesQueryDto,
  ) {
    return this.cajaService.getDisponibles(user, query.sucursal_id);
  }

  @Get('turno/actual')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Turno de caja abierto del usuario',
    description: 'Paridad GET /api/caja/turno/actual',
  })
  getTurnoActual(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: CajaTurnoActualQueryDto,
  ) {
    return this.cajaService.getTurnoActual(user, query.sucursal_id);
  }

  @Post('turno/abrir')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Abrir turno de caja',
    description: 'Paridad POST /api/caja/turno/abrir',
  })
  abrirTurno(@CurrentUser() user: AccessTokenPayload, @Body() dto: AbrirTurnoDto) {
    return this.cajaService.abrirTurno(user, dto);
  }

  @Post('turno/cerrar')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cerrar turno con cierre Z',
    description: 'Paridad POST /api/caja/turno/cerrar',
  })
  cerrarTurno(@CurrentUser() user: AccessTokenPayload, @Body() dto: CerrarTurnoDto) {
    return this.cajaService.cerrarTurno(user, dto);
  }

  @Get('cierre-z')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Historial de cierres Z',
    description: 'Paridad GET /api/caja/cierre-z',
  })
  listCierreZ(@Query() query: CajaCierreZQueryDto) {
    return this.cajaService.listCierreZ(
      query.sucursal_id,
      query.fecha_operativa,
      query.caja_id,
      query.limit ?? 60,
    );
  }

  @Get('turnos/historial')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Historial de turnos cerrados' })
  listTurnosHistorial(@Query() query: CajaTurnosHistorialQueryDto) {
    return this.cajaService.listTurnosHistorial(query.sucursal_id, query.limit ?? 30);
  }
}
