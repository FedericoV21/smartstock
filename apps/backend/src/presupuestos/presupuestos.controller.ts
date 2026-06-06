import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { ConvertirAFacturaDto, ConvertirATicketDto } from './dto/convertir-presupuesto.dto';
import { ListPresupuestosQueryDto } from './dto/list-presupuestos-query.dto';
import { PresupuestosService } from './presupuestos.service';

@ApiTags('presupuestos')
@ApiBearerAuth('access-token')
@Controller('presupuestos')
export class PresupuestosController {
  constructor(private readonly presupuestosService: PresupuestosService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Listar presupuestos paginados con conversiones',
    description: 'Paridad GET /api/presupuestos',
  })
  list(@Query() query: ListPresupuestosQueryDto) {
    return this.presupuestosService.list(query);
  }

  @Get(':id')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Detalle de presupuesto',
    description: 'Paridad GET /api/presupuestos/[id]',
  })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.presupuestosService.getById(id);
  }

  @Post(':id/convertir-a-pedido')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Convertir presupuesto a pedido borrador',
    description: 'Paridad POST /api/presupuestos/[id]/convertir-a-pedido',
  })
  convertirAPedido(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('sucursal_id') sucursalId: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.presupuestosService.convertirAPedido(id, sucursalId, user.sub);
  }

  @Post(':id/convertir-a-factura')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Convertir presupuesto a factura fiscal',
    description: 'Paridad POST /api/presupuestos/[id]/convertir-a-factura',
  })
  convertirAFactura(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertirAFacturaDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.presupuestosService.convertirAFactura(id, dto, user.sub);
  }

  @Post(':id/convertir-a-ticket')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Convertir presupuesto a ticket no fiscal',
    description: 'Paridad POST /api/presupuestos/[id]/convertir-a-ticket',
  })
  convertirATicket(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertirATicketDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.presupuestosService.convertirATicket(id, dto, user.sub);
  }
}
