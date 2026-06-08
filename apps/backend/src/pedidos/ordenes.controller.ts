import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { OrdenLookupService } from './orden-lookup.service';

@ApiTags('ordenes')
@ApiBearerAuth('access-token')
@Controller('ordenes')
export class OrdenesController {
  constructor(private readonly ordenLookupService: OrdenLookupService) {}

  @Get(':numero_orden')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Documentos vinculados a una orden de venta interna',
    description: 'Paridad GET /api/ordenes/[numero_orden]. Comprobantes + pedidos del tenant.',
  })
  lookup(
    @Param('numero_orden') numeroOrden: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ordenLookupService.lookup(numeroOrden, user);
  }
}
