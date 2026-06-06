import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { CreateSupplierObligationDto } from './dto/create-supplier-obligation.dto';
import { ImportSupplierObligationService } from './import-supplier-obligation.service';

@ApiTags('importaciones')
@ApiBearerAuth('access-token')
@Controller('importaciones/supplier-obligations')
export class ImportSupplierObligationController {
  constructor(private readonly service: ImportSupplierObligationService) {}

  @Post()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Registrar obligaci├│n a proveedor por importaci├│n de lista',
    description: 'Paridad POST /api/importar/obligacion-proveedor.',
  })
  create(@Body() dto: CreateSupplierObligationDto) {
    return this.service.create(dto);
  }
}
