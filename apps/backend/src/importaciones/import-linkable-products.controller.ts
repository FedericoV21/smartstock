import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { ListLinkableProductsQueryDto } from './dto/list-linkable-products-query.dto';
import { ImportLinkableProductsService } from './import-linkable-products.service';

@ApiTags('importaciones')
@ApiBearerAuth('access-token')
@Controller('importaciones/linkable-products')
export class ImportLinkableProductsController {
  constructor(private readonly service: ImportLinkableProductsService) {}

  @Get()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Buscar productos enlazables en importaci├│n',
    description: 'Paridad GET /api/importar/productos-enlazables.',
  })
  list(@Query() query: ListLinkableProductsQueryDto) {
    return this.service.list(query);
  }
}
