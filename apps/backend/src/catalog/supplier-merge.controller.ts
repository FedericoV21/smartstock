import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { MergeSuppliersDto } from './dto/merge-suppliers.dto';
import { SupplierMergeService } from './supplier-merge.service';

@ApiTags('catalog')
@ApiBearerAuth('access-token')
@Controller('suppliers/merge')
export class SupplierMergeController {
  constructor(private readonly supplierMergeService: SupplierMergeService) {}

  @Post()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Fusionar proveedores duplicados',
    description:
      'Paridad POST /api/proveedores/fusionar. Repunta FKs del esquema Nest, consolida cuenta corriente y elimina perdedores. Requiere m├│dulo stock.',
  })
  merge(@Body() dto: MergeSuppliersDto) {
    return this.supplierMergeService.merge(dto);
  }
}
