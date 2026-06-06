import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { BranchStockService } from './branch-stock.service';
import { CreateBranchStockDto } from './dto/create-branch-stock.dto';
import { ListBranchStockQueryDto } from './dto/list-branch-stock-query.dto';
import { UpdateBranchStockDto } from './dto/update-branch-stock.dto';

@ApiTags('branch-stock')
@ApiBearerAuth('access-token')
@Controller()
export class BranchStockController {
  constructor(private readonly branchStockService: BranchStockService) {}

  @Get('inventory/branch-stock')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Stock por dep├│sito (sucursal activa o query sucursalId)' })
  listByBranch(@Query() query: ListBranchStockQueryDto) {
    return this.branchStockService.listByBranch(query);
  }

  @Post('inventory/branch-stock/materialize')
  @Roles('admin')
  @ApiOperation({ summary: 'Crear filas stock_sucursal faltantes (stock 0) para el tenant' })
  materialize() {
    return this.branchStockService.materializeForTenant();
  }

  @Get('products/:productId/branch-stock/available')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Sucursales activas sin fila stock_sucursal para el producto' })
  listAvailable(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.branchStockService.listAvailableBranches(productId);
  }

  @Get('products/:productId/branch-stock')
  @Roles('admin', 'operador', 'visor')
  listForProduct(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.branchStockService.listForProduct(productId);
  }

  @Post('products/:productId/branch-stock')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Habilitar stock del producto en un dep├│sito (fila en 0)' })
  enable(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateBranchStockDto,
  ) {
    return this.branchStockService.enableForProduct(productId, dto);
  }

  @Patch('products/:productId/branch-stock')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Actualizar stock_minimo / ubicacion por dep├│sito' })
  update(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateBranchStockDto,
  ) {
    return this.branchStockService.updateForProduct(productId, dto);
  }
}
