import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import {
  PasarelaCancelarDto,
  PasarelaEstadoQueryDto,
  PasarelaIniciarDto,
  PasarelaSincronizarDto,
} from './dto/pasarela-cobros.dto';
import { PasarelasCobrosService } from './pasarelas-cobros.service';

@ApiTags('pagos')
@ApiBearerAuth('access-token')
@Controller('pagos/pasarela')
export class PasarelasCobrosController {
  constructor(private readonly service: PasarelasCobrosService) {}

  @Post('iniciar')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Iniciar cobro pasarela unificada',
    description: 'Paridad POST /api/pagos/pasarela/iniciar',
  })
  iniciar(@CurrentUser() user: AccessTokenPayload, @Body() dto: PasarelaIniciarDto) {
    return this.service.iniciar(user, dto.integracion_id, dto.comprobante_id, dto.total);
  }

  @Get('estado')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Estado transaccion pasarela',
    description: 'Paridad GET /api/pagos/pasarela/estado',
  })
  estado(@Query() query: PasarelaEstadoQueryDto) {
    if (!query.transaccion_id && !query.comprobante_id) {
      throw new BadRequestException('transaccion_id o comprobante_id requerido');
    }
    return this.service.getEstado(query.transaccion_id, query.comprobante_id);
  }

  @Post('cancelar')
  @Roles('admin', 'operador')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancelar cobro pasarela',
    description: 'Paridad POST /api/pagos/pasarela/cancelar',
  })
  cancelar(@CurrentUser() user: AccessTokenPayload, @Body() dto: PasarelaCancelarDto) {
    return this.service.cancelar(
      user,
      dto.comprobante_id,
      dto.integracion_id,
      dto.liberar_qr === true,
    );
  }

  @Post('sincronizar')
  @Roles('admin', 'operador')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sincronizar cobro pasarela con proveedor',
    description: 'Paridad POST /api/pagos/pasarela/sincronizar',
  })
  sincronizar(@CurrentUser() user: AccessTokenPayload, @Body() dto: PasarelaSincronizarDto) {
    return this.service.sincronizar(user, dto.comprobante_id, dto.integracion_id);
  }
}
