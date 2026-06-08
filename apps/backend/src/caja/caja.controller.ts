import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { CajaGastosService } from './caja-gastos.service';
import { CajaService } from './caja.service';
import {
  CajaCierreResumenQueryDto,
  CajaGastosQueryDto,
  CajaHistorialMovimientosQueryDto,
  CreateCajaGastoDto,
} from './dto/caja-gastos.dto';
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
  constructor(
    private readonly cajaService: CajaService,
    private readonly cajaGastosService: CajaGastosService,
  ) {}

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

  @Get('gastos')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Gastos vigentes de la sesión de caja',
    description: 'Paridad GET /api/caja/gastos',
  })
  listGastos(@CurrentUser() user: AccessTokenPayload, @Query() query: CajaGastosQueryDto) {
    return this.cajaGastosService.listGastos(user, query.caja_id, query.sucursal_id);
  }

  @Post('gastos')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar gasto en sesión de caja',
    description: 'Paridad POST /api/caja/gastos',
  })
  createGasto(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateCajaGastoDto) {
    return this.cajaGastosService.createGasto(user, dto.caja_id, dto.concepto, dto.monto);
  }

  @Delete('gastos/:id')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Anular gasto de sesión',
    description: 'Paridad DELETE /api/caja/gastos/:id',
  })
  anularGasto(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.cajaGastosService.anularGasto(user, id);
  }

  @Get('historial-movimientos')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Historial de aperturas y cierres por fecha operativa',
    description: 'Paridad GET /api/caja/historial-movimientos',
  })
  listHistorialMovimientos(
    @Query() query: CajaHistorialMovimientosQueryDto,
  ) {
    return this.cajaService.listHistorialMovimientos(
      query.sucursal_id,
      query.fecha_operativa,
      query.caja_id,
      query.incluir_ultimos === '1',
    );
  }

  @Get('cierre-z/:id/resumen')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Detalle de cierre Z con comprobantes',
    description: 'Paridad GET /api/caja/cierre-z/:id/resumen',
  })
  getCierreZResumen(@Param('id') id: string, @Query() query: CajaCierreResumenQueryDto) {
    return this.cajaService.getCierreZResumen(id, query.sucursal_id);
  }
}
