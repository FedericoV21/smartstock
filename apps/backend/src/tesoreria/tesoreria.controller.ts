import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { CambiarEstadoChequeDto, RegistrarChequeDto } from './dto/cheque.dto';
import { IngresoEfectivoDto, TransferenciaDesdeCajaDto } from './dto/ingreso-efectivo.dto';
import { PagoProveedorTesoreriaDto } from './dto/pago-proveedor.dto';
import {
  ChequesQueryDto,
  ObligacionesQueryDto,
  TesoreriaOverviewQueryDto,
} from './dto/tesoreria-query.dto';
import { TesoreriaService } from './tesoreria.service';

@ApiTags('tesoreria')
@ApiBearerAuth('access-token')
@Controller('tesoreria')
export class TesoreriaController {
  constructor(private readonly service: TesoreriaService) {}

  @Get()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Panel tesorer├¡a (saldo, movimientos, cheques)',
    description: 'Paridad GET /api/tesoreria. Requiere facturador_simple y cajaInterna habilitada.',
  })
  getOverview(@Query() query: TesoreriaOverviewQueryDto) {
    return this.service.getOverview(query);
  }

  @Post('ingreso-efectivo')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Ingreso de efectivo', description: 'Paridad POST /api/tesoreria/ingreso-efectivo' })
  ingresoEfectivo(
    @Body() dto: IngresoEfectivoDto,
    @CurrentUser() user: AccessTokenPayload,
    @Query('sucursal_id') sucursalId?: string,
  ) {
    return this.service.ingresoEfectivo(dto, user, sucursalId);
  }

  @Post('transferencia-desde-caja')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Transferencia manual desde caja POS',
    description: 'Paridad POST /api/tesoreria/transferencia-desde-caja',
  })
  transferenciaDesdeCaja(
    @Body() dto: TransferenciaDesdeCajaDto,
    @CurrentUser() user: AccessTokenPayload,
    @Query('sucursal_id') sucursalId?: string,
  ) {
    return this.service.transferenciaDesdeCaja(dto, user, sucursalId);
  }

  @Get('cheques')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Listar cheques en cartera' })
  listCheques(@Query() query: ChequesQueryDto) {
    return this.service.listCheques(query);
  }

  @Post('cheques')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Registrar cheque en cartera' })
  registrarCheque(
    @Body() dto: RegistrarChequeDto,
    @CurrentUser() user: AccessTokenPayload,
    @Query('sucursal_id') sucursalId?: string,
  ) {
    return this.service.registrarCheque(dto, user, sucursalId);
  }

  @Patch('cheques/:id/estado')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Depositar o rechazar cheque' })
  cambiarEstadoCheque(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarEstadoChequeDto,
    @CurrentUser() user: AccessTokenPayload,
    @Query('sucursal_id') sucursalId?: string,
  ) {
    return this.service.cambiarEstadoCheque(id, dto, user, sucursalId);
  }

  @Post('pago-proveedor')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Pago a proveedor desde tesorer├¡a' })
  pagoProveedor(
    @Body() dto: PagoProveedorTesoreriaDto,
    @CurrentUser() user: AccessTokenPayload,
    @Query('sucursal_id') sucursalId?: string,
  ) {
    return this.service.pagoProveedor(dto, user, sucursalId);
  }

  @Get('obligaciones')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Obligaciones pendientes de un proveedor' })
  getObligaciones(@Query() query: ObligacionesQueryDto) {
    return this.service.getObligaciones(query);
  }

  @Get('cierres-recientes')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Cierres Z recientes para transferencia desde caja POS' })
  getCierresRecientes(
    @Query('sucursal_id') sucursalId?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Math.min(Number(limit) || 20, 50) : 20;
    return this.service.getCierresRecientes(sucursalId, n);
  }
}
