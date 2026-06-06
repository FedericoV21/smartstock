import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { CreateProductoVarianteDto } from './dto/create-producto-variante.dto';
import { UpdateProductoVarianteDto } from './dto/update-producto-variante.dto';
import { UpsertVariantBranchStockDto } from './dto/upsert-variant-branch-stock.dto';
import { ProductVariantsService } from './product-variants.service';

@ApiTags('product-variants')
@ApiBearerAuth('access-token')
@Controller()
export class ProductVariantsController {
  constructor(private readonly productVariantsService: ProductVariantsService) {}

  @Get('products/:productId/variants')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Variantes de un producto con stock por dep├│sito' })
  list(
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.productVariantsService.listForProduct(productId, user);
  }

  @Post('products/:productId/variants')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Crea variante e inicializa stock en dep├│sitos operables' })
  create(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateProductoVarianteDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.productVariantsService.create(productId, dto, user);
  }

  @Patch('products/:productId/variants/:variantId')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Actualiza atributos/c├│digo/estado de una variante' })
  update(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateProductoVarianteDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.productVariantsService.update(productId, variantId, dto, user);
  }

  @Delete('products/:productId/variants/:variantId')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Desactiva una variante (soft delete)' })
  remove(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.productVariantsService.softDelete(productId, variantId, user);
  }

  @Patch('products/:productId/variants/:variantId/branch-stock')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Upsert stock de variante en un dep├│sito' })
  upsertBranchStock(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpsertVariantBranchStockDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.productVariantsService.upsertBranchStock(
      productId,
      variantId,
      dto,
      user,
    );
  }
}
