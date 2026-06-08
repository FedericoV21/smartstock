import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ConfigurarMpTransferenciaReportesDto,
  ConfirmarMpTransferenciaDto,
  MpTransferenciaComprobanteDto,
  MpTransferenciaDiagnosticoQueryDto,
} from './dto/mp-transferencia.dto';
import { MpTransferenciaService } from './mp-transferencia.service';

@ApiTags('pagos')
@ApiBearerAuth('access-token')
@Controller('pagos/mp-transferencia')
export class MpTransferenciaController {
  constructor(private readonly service: MpTransferenciaService) {}

  @Post('iniciar')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Iniciar verificación Transferencia MP',
    description: 'Paridad POST /api/pagos/mp-transferencia/iniciar.',
  })
  iniciar(@Body() dto: MpTransferenciaComprobanteDto) {
    return this.service.iniciar(dto.comprobante_id);
  }

  @Post('verificar')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Buscar transferencia MP coincidente',
    description: 'Paridad POST /api/pagos/mp-transferencia/verificar.',
  })
  verificar(@Body() dto: MpTransferenciaComprobanteDto) {
    return this.service.verificar(dto.comprobante_id);
  }

  @Post('confirmar')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Confirmar transferencia y emitir comprobante',
    description: 'Paridad POST /api/pagos/mp-transferencia/confirmar.',
  })
  confirmar(@Body() dto: ConfirmarMpTransferenciaDto, @CurrentUser() user: AccessTokenPayload) {
    return this.service.confirmar(dto.comprobante_id, dto.movimiento_id, user.sub);
  }

  @Post('cancelar')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Cancelar verificación Transferencia MP',
    description: 'Paridad POST /api/pagos/mp-transferencia/cancelar.',
  })
  cancelar(@Body() dto: MpTransferenciaComprobanteDto) {
    return this.service.cancelar(dto.comprobante_id);
  }

  @Get('diagnostico')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Diagnóstico conexión MP Transferencia',
    description: 'Paridad GET /api/pagos/mp-transferencia/diagnostico.',
  })
  diagnostico(
    @Query() _query: MpTransferenciaDiagnosticoQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.diagnostico(user);
  }

  @Post('configurar-reportes')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configurar reportes settlement MP para transferencias',
    description: 'Paridad POST /api/pagos/mp-transferencia/configurar-reportes.',
  })
  configurarReportes(
    @Body() dto: ConfigurarMpTransferenciaReportesDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.configurarReportes(user, dto);
  }
}
