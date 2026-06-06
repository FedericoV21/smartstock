import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { CreateMovimientoDto } from './dto/create-movimiento.dto';
import { ListAlertasQueryDto } from './dto/list-alertas-query.dto';
import { ListMovimientosQueryDto } from './dto/list-movimientos-query.dto';
import { ListVencimientosAlertasQueryDto } from './dto/list-vencimientos-alertas-query.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth('access-token')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('alertas/stock-bajo')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Productos con stock_actual <= stock_minimo',
    description: 'Solo activos del tenant. Orden por nombre. Ver ├¡ndice `idx_producto_alert_stock_bajo` en migraci├│n 041.',
  })
  listStockBajo(@Query() query: ListAlertasQueryDto) {
    return this.inventoryService.listStockBajoAlertas(query);
  }

  @Get('alertas/vencimientos')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Productos con vencimiento hasta hoy + N d├¡as (UTC)',
    description:
      'Incluye ya vencidos. Query `dias` (default 30). Ver ├¡ndice `idx_producto_alert_vencimiento` en migraci├│n 041.',
  })
  listVencimientos(@Query() query: ListVencimientosAlertasQueryDto) {
    return this.inventoryService.listVencimientosAlertas(query);
  }

  @Get('movimientos')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Historial de movimientos de stock',
    description: 'Paginado; filtros opcionales por tipo, producto y rango de fechas (UTC d├¡a completo).',
  })
  listMovimientos(@Query() query: ListMovimientosQueryDto) {
    return this.inventoryService.listMovimientos(query);
  }

  @Post('movimientos')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Registrar movimiento de stock (entrada / salida / ajuste)',
    description:
      'Delega en la funci├│n SQL `registrar_movimiento` (bloqueo FOR UPDATE, rechazo de stock negativo en salidas).',
  })
  registrarMovimiento(
    @Body() dto: CreateMovimientoDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.registrarMovimiento(dto, user.sub);
  }
}
