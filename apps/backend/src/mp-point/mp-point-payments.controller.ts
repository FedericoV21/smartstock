import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import {
  CancelarMpPointPagoDto,
  IniciarMpPointPagoDto,
  MpPointEstadoQueryDto,
  SincronizarMpPointPagoDto,
} from './dto/mp-point-payment.dto';
import { MpPointConfigQueryDto } from './dto/mp-point-config.dto';
import { MpPointPaymentService } from './mp-point-payment.service';

@ApiTags('pagos')
@ApiBearerAuth('access-token')
@Controller('pagos/mp-point')
export class MpPointPaymentsController {
  constructor(private readonly paymentService: MpPointPaymentService) {}

  @Post('iniciar')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Enviar cobro a terminal MP Point',
    description: 'Paridad POST /api/pagos/mp-point/iniciar. Requiere facturador_pos.',
  })
  iniciar(@Body() dto: IniciarMpPointPagoDto) {
    return this.paymentService.iniciar(dto.comprobante_id, dto.total);
  }

  @Post('cancelar')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Cancelar cobro en terminal MP Point',
    description: 'Paridad POST /api/pagos/mp-point/cancelar.',
  })
  cancelar(@Body() dto: CancelarMpPointPagoDto) {
    return this.paymentService.cancelar(dto.comprobante_id);
  }

  @Get('estado')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Estado del intent Point (solo lectura, rate-limit 5s)',
    description: 'Paridad GET /api/pagos/mp-point/estado?comprobante_id=',
  })
  getEstado(@Query() query: MpPointEstadoQueryDto) {
    return this.paymentService.getEstado(query.comprobante_id);
  }

  @Post('sincronizar')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Consultar estado MP Point y procesar cobro si aplica',
    description:
      'Paridad POST /api/pagos/mp-point/sincronizar. Dispara reconciliaci├│n cuando el intent finaliz├│.',
  })
  sincronizar(@Body() dto: SincronizarMpPointPagoDto) {
    return this.paymentService.sincronizar(dto.comprobante_id);
  }

  @Get('estado/pendiente')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: '├Ültimo comprobante pendiente_posnet del tenant (recuperaci├│n POS)',
    description: 'Paridad GET /api/pagos/mp-point/estado/pendiente.',
  })
  getPendiente() {
    return this.paymentService.getPendienteRecuperacion();
  }

  @Get('devices')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Listar terminales MP Point de la cuenta',
    description:
      'Paridad GET /api/pagos/mp-point/devices?sucursal_id=. Incluye advertencia si hay STANDALONE.',
  })
  listDevices(@Query() query: MpPointConfigQueryDto) {
    return this.paymentService.listDevices(query.sucursal_id);
  }
}
