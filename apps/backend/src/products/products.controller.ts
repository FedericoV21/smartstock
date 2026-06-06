import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { BulkByFilterDto } from './dto/bulk-by-filter.dto';
import { BulkMarginDto } from './dto/bulk-margin.dto';
import { CreateProductoBarcodeDto } from './dto/create-producto-barcode.dto';
import { CreateProductoDto } from './dto/create-producto.dto';
import { GetProductoQueryDto } from './dto/get-producto-query.dto';
import { ListProductoBarcodesQueryDto } from './dto/list-producto-barcodes-query.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductoBarcodeDto } from './dto/update-producto-barcode.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth('access-token')
@Roles('admin', 'operador', 'visor')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar productos del tenant (filtros extendidos alineados al front)',
    description:
      'Soporta categor├¡a, proveedor, stock bajo, vencidos, alcance tenant/sucursal, overlay stock por dep├│sito, variantes y soloIds.',
  })
  list(@Query() query: ListProductsQueryDto, @CurrentUser() user: AccessTokenPayload) {
    return this.productsService.list(query, user);
  }

  @Post()
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Crear producto' })
  create(@Body() dto: CreateProductoDto) {
    return this.productsService.create(dto);
  }

  @Patch('bulk-margin')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Actualizar porcentaje de ganancia en lote',
    description: 'Paridad PATCH /api/productos/bulk-ganancia (m├íx. 250 ids).',
  })
  bulkMargin(@Body() dto: BulkMarginDto, @CurrentUser() user: AccessTokenPayload) {
    return this.productsService.bulkUpdateMargin(dto, user);
  }

  @Patch('bulk-by-filter')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Baja o reactivaci├│n masiva por filtros de listado',
    description: 'Paridad PATCH /api/productos/bulk-por-filtro. Requiere filtro por proveedor.',
  })
  bulkByFilter(@Body() dto: BulkByFilterDto, @CurrentUser() user: AccessTokenPayload) {
    return this.productsService.bulkUpdateActiveByFilter(dto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener producto por id' })
  getOne(@Param('id', ParseUUIDPipe) id: string, @Query() query: GetProductoQueryDto) {
    return this.productsService.getById(id, query);
  }

  @Patch(':id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Actualizar producto' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductoDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Baja l├│gica (activo = false)' })
  softDelete(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.softDelete(id);
  }

  @Get(':id/barcodes')
  @ApiOperation({ summary: 'Listar c├│digos de barras del producto' })
  listBarcodes(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListProductoBarcodesQueryDto,
  ) {
    return this.productsService.listBarcodes(id, query);
  }

  @Post(':id/generate-barcode')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generar EAN-13 interno (prefijo 135)',
    description:
      'Paridad con POST /api/productos/[id]/generar-codigo del front. Rechaza si el producto ya tiene barcode o es pesable.',
  })
  generateInternalBarcode(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.generateInternalBarcode(id);
  }

  @Post(':id/barcodes')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Crear c├│digo de barras para un producto' })
  createBarcode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProductoBarcodeDto,
  ) {
    return this.productsService.createBarcode(id, dto);
  }

  @Patch(':id/barcodes/:barcodeId')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Actualizar c├│digo de barras de un producto' })
  updateBarcode(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
    @Body() dto: UpdateProductoBarcodeDto,
  ) {
    return this.productsService.updateBarcode(id, barcodeId, dto);
  }

  @Delete(':id/barcodes/:barcodeId')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Baja l├│gica del c├│digo de barras (activo = false)' })
  softDeleteBarcode(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
  ) {
    return this.productsService.softDeleteBarcode(id, barcodeId);
  }
}
