import {
  Body,
  Controller,
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
import { CreateProductoLoteDto } from './dto/create-producto-lote.dto';
import { UpdateProductoLoteDto } from './dto/update-producto-lote.dto';
import { ProductLotesService } from './product-lotes.service';

@ApiTags('product-lotes')
@ApiBearerAuth('access-token')
@Controller('products/:productId/lotes')
export class ProductLotesController {
  constructor(private readonly productLotesService: ProductLotesService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Lotes de ingreso del producto (vencimientos por partida)' })
  list(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.productLotesService.listByProduct(productId);
  }

  @Post()
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Registrar lote de ingreso manual' })
  create(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateProductoLoteDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.productLotesService.create(productId, dto, user.sub);
  }

  @Patch(':loteId')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Actualizar cantidad o vencimiento de un lote' })
  update(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('loteId', ParseUUIDPipe) loteId: string,
    @Body() dto: UpdateProductoLoteDto,
  ) {
    return this.productLotesService.update(productId, loteId, dto);
  }
}
