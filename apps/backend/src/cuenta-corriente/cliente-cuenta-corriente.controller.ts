import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { ClienteCuentaCorrienteService } from './cliente-cuenta-corriente.service';
import { ExtractoQueryDto } from './dto/extracto-query.dto';
import { LiquidarItemsDto } from './dto/liquidar-items.dto';
import { MovimientosDiaQueryDto } from './dto/movimientos-dia-query.dto';
import { PatchPagoExtractoDto } from './dto/patch-pago-extracto.dto';
import { PatchClienteCuentaCorrienteDto } from './dto/patch-cliente-cuenta-corriente.dto';
import { RegistrarPagoDto } from './dto/registrar-pago.dto';

@ApiTags('cuenta-corriente')
@ApiBearerAuth('access-token')
@Controller('customers/:customerId/cuenta-corriente')
export class ClienteCuentaCorrienteController {
  constructor(private readonly service: ClienteCuentaCorrienteService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Obtener cuenta corriente del cliente',
    description: 'Paridad GET /api/clientes/:id/cuenta-corriente',
  })
  getCuenta(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.service.getCuenta(customerId);
  }

  @Patch()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Actualizar condiciones de cobro de cuenta corriente',
    description: 'Paridad PATCH /api/clientes/:id/cuenta-corriente',
  })
  patchCuenta(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: PatchClienteCuentaCorrienteDto,
  ) {
    return this.service.patchCuenta(customerId, dto);
  }

  @Get('extracto')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Extracto de cuenta corriente',
    description: 'Paridad GET /api/clientes/:id/cuenta-corriente/extracto. export=csv para descarga.',
  })
  async getExtracto(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() query: ExtractoQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.getExtracto(customerId, query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Get('movimientos-dia')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Movimientos CC del d├¡a por sucursal',
    description: 'Paridad GET /api/clientes/:id/cuenta-corriente/movimientos-dia',
  })
  getMovimientosDia(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() query: MovimientosDiaQueryDto,
  ) {
    return this.service.getMovimientosDia(customerId, query);
  }

  @Patch('liquidar-items')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Liquidar precios de ├¡tems del d├¡a',
    description: 'Paridad PATCH /api/clientes/:id/cuenta-corriente/liquidar-items',
  })
  liquidarItems(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: LiquidarItemsDto,
  ) {
    return this.service.liquidarItems(customerId, dto);
  }

  @Post('pagos')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Registrar pago a cuenta corriente del cliente',
    description: 'Paridad POST /api/analizador/cuenta-corriente/pago (cliente en ruta)',
  })
  registrarPago(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: RegistrarPagoDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.registrarPago(customerId, dto, user.sub);
  }

  @Get('comprobantes/:comprobanteId/liquidacion')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Ítems liquidables de un comprobante CC del día',
    description:
      'Paridad GET /api/clientes/:id/cuenta-corriente/comprobantes/:comprobanteId/liquidacion.',
  })
  getLiquidacionComprobante(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('comprobanteId', ParseUUIDPipe) comprobanteId: string,
    @Query() query: MovimientosDiaQueryDto,
  ) {
    return this.service.getLiquidacionComprobante(customerId, comprobanteId, query);
  }

  @Patch('pagos/:pagoId')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Actualizar pago desde extracto CC',
    description: 'Paridad PATCH /api/clientes/:id/cuenta-corriente/pagos/:pagoId.',
  })
  actualizarPago(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('pagoId', ParseUUIDPipe) pagoId: string,
    @Body() dto: PatchPagoExtractoDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.actualizarPagoExtracto(customerId, pagoId, dto, user);
  }
}
