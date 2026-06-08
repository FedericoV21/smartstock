import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { MpQrConfigQueryDto, VerificarMpQrConfigDto } from './dto/mp-qr-config.dto';
import {
  CancelarMpQrPagoDto,
  IniciarMpQrPagoDto,
  MpQrEstadoQueryDto,
  SincronizarMpQrPagoDto,
} from './dto/mp-qr-payment.dto';
import { MpQrConfigService } from './mp-qr-config.service';
import { MpQrPaymentService } from './mp-qr-payment.service';

@ApiTags('pagos')
@ApiBearerAuth('access-token')
@Controller('pagos/mp-qr')
export class MpQrPaymentsController {
  constructor(
    private readonly paymentService: MpQrPaymentService,
    private readonly configService: MpQrConfigService,
  ) {}

  @Post('iniciar')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Iniciar cobro QR instore',
    description: 'Paridad POST /api/pagos/mp-qr/iniciar.',
  })
  iniciar(@Body() dto: IniciarMpQrPagoDto) {
    return this.paymentService.iniciar(dto.comprobante_id, dto.total);
  }

  @Post('cancelar')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Cancelar cobro QR',
    description: 'Paridad POST /api/pagos/mp-qr/cancelar.',
  })
  cancelar(@Body() dto: CancelarMpQrPagoDto) {
    return this.paymentService.cancelar(dto.comprobante_id, dto.liberar_qr === true);
  }

  @Get('estado')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Estado del cobro QR (solo lectura)',
    description: 'Paridad GET /api/pagos/mp-qr/estado?comprobante_id=',
  })
  getEstado(@Query() query: MpQrEstadoQueryDto) {
    return this.paymentService.getEstado(query.comprobante_id);
  }

  @Post('sincronizar')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Sincronizar cobro QR con Mercado Pago',
    description: 'Paridad POST /api/pagos/mp-qr/sincronizar.',
  })
  sincronizar(@Body() dto: SincronizarMpQrPagoDto) {
    return this.paymentService.sincronizar(dto.comprobante_id);
  }

  @Post('verificar')
  @Roles('admin')
  @ApiOperation({
    summary: 'Verificar credenciales MP QR',
    description: 'Paridad POST /api/pagos/mp-qr/verificar.',
  })
  verificar(@Body() dto: VerificarMpQrConfigDto, @Query() query: MpQrConfigQueryDto) {
    return this.configService.verificarConfig(dto, query.sucursal_id);
  }
}
