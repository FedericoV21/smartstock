import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { MergeProductsDto } from './dto/merge-products.dto';
import { ProductMergeService } from './product-merge.service';

@ApiTags('product-merge')
@ApiBearerAuth('access-token')
@Controller('products/merge')
export class ProductMergeController {
  constructor(private readonly productMergeService: ProductMergeService) {}

  @Post()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Fusionar producto duplicado en otro',
    description:
      'Paridad POST /api/productos/fusionar. Mismo proveedor y sucursal; repunta FKs, suma stock, elimina el perdedor.',
  })
  merge(@Body() dto: MergeProductsDto) {
    return this.productMergeService.merge(dto);
  }
}
