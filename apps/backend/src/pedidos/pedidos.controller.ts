import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { ChangePedidoEstadoDto } from './dto/change-pedido-estado.dto';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { FacturarPedidoDto } from './dto/facturar-pedido.dto';
import { ListPedidosQueryDto } from './dto/list-pedidos-query.dto';
import { PedidosService } from './pedidos.service';

@ApiTags('pedidos')
@ApiBearerAuth('access-token')
@Controller('pedidos')
export class PedidosController {
  constructor(private readonly pedidosService: PedidosService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar pedidos del tenant' })
  list(@Query() query: ListPedidosQueryDto) {
    return this.pedidosService.list(query);
  }

  @Post()
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Crear pedido en estado borrador' })
  create(@Body() dto: CreatePedidoDto, @CurrentUser() user: AccessTokenPayload) {
    return this.pedidosService.create(dto, user.sub);
  }

  @Get(':id')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Obtener detalle de pedido' })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.pedidosService.getById(id);
  }

  @Get(':id/disponibilidad')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Ver stock actual/comprometido/disponible para los items del pedido' })
  disponibilidad(@Param('id', ParseUUIDPipe) id: string) {
    return this.pedidosService.getDisponibilidad(id);
  }

  @Patch(':id/estado')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Cambiar estado de pedido (workflow + fase) con efectos de stock',
    description:
      'Paridad PATCH /api/pedidos/:id/estado. Acepta workflow_estado_id, workflow_slug o estado legacy. Valida transiciones de workflow y fase.',
  })
  changeEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePedidoEstadoDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.pedidosService.changeEstado(id, dto, user.sub);
  }

  @Post(':id/facturar')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Convertir pedido entregado a comprobante sin mover stock nuevamente' })
  facturar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FacturarPedidoDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.pedidosService.facturar(id, dto, user.sub);
  }
}
