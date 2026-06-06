import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { CobranzaService } from './cobranza.service';
import { RegistrarPagoCobranzaDto } from './dto/registrar-pago-cobranza.dto';

@ApiTags('cobranza')
@ApiBearerAuth('access-token')
@Controller('cobranza')
export class CobranzaController {
  constructor(private readonly cobranzaService: CobranzaService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Listado de cobranzas abiertas',
    description: 'Paridad GET /api/cobranza?cliente_id=',
  })
  @ApiQuery({ name: 'cliente_id', required: false })
  list(@Query('cliente_id') clienteId?: string) {
    return this.cobranzaService.list(clienteId);
  }

  @Get('pendientes')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Campa├▒a de cobranza',
    description:
      'Paridad GET /api/cobranza/pendientes ÔÇö condiciones CC, legacy tickets, URLs WhatsApp',
  })
  pendientes() {
    return this.cobranzaService.listPendientes();
  }

  @Post(':id/pago')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar pago parcial o total',
    description: 'Paridad POST /api/cobranza/[id]/pago ÔÇö incluye recibo PDF opcional',
  })
  registrarPago(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarPagoCobranzaDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.cobranzaService.registrarPago(id, dto, user.sub);
  }

  @Post(':id/snooze')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Posponer recordatorio 24h',
    description: 'Paridad POST /api/cobranza/[id]/snooze',
  })
  snooze(@Param('id', ParseUUIDPipe) id: string) {
    return this.cobranzaService.snooze(id);
  }

  @Delete(':id/snooze')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Quitar posponer recordatorio',
    description: 'Paridad DELETE /api/cobranza/[id]/snooze',
  })
  clearSnooze(@Param('id', ParseUUIDPipe) id: string) {
    return this.cobranzaService.clearSnooze(id);
  }
}
