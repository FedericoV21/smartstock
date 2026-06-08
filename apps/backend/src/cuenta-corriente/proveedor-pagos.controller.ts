import { Controller, ForbiddenException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { ProveedorPagoRevertirService } from './proveedor-pago-revertir.service';

@ApiTags('cuenta-corriente')
@ApiBearerAuth('access-token')
@Controller('suppliers/:supplierId/pagos')
export class ProveedorPagosController {
  constructor(private readonly service: ProveedorPagoRevertirService) {}

  @Post(':pagoId/revertir')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Revertir pago a cuenta corriente del proveedor',
    description: 'Paridad POST /api/proveedores/:id/pagos/:pagoId/revertir.',
  })
  revertir(
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Param('pagoId', ParseUUIDPipe) pagoId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden revertir pagos.');
    }
    return this.service.revertir(supplierId, pagoId);
  }
}
