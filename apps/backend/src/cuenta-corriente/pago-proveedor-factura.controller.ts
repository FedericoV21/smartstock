import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { RegistrarPagoProveedorFacturaDto } from './dto/registrar-pago-proveedor-factura.dto';
import { PagoProveedorFacturaService } from './pago-proveedor-factura.service';

@ApiTags('cuenta-corriente')
@ApiBearerAuth('access-token')
@Controller('pago-proveedor-factura')
export class PagoProveedorFacturaController {
  constructor(private readonly service: PagoProveedorFacturaService) {}

  @Post(':id/pago')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Registrar pago contra obligación de proveedor',
    description: 'Paridad POST /api/pago-proveedor-factura/:id/pago. Usa registrar_pago_proveedor_obligacion.',
  })
  registrar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarPagoProveedorFacturaDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden registrar pagos.');
    }
    return this.service.registrar(id, dto, user.sub);
  }
}
