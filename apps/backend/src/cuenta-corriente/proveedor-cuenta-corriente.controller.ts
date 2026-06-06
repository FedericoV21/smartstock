import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { ExtractoQueryDto } from './dto/extracto-query.dto';
import { PagoCuentaProveedorDto } from './dto/pago-cuenta-proveedor.dto';
import { PagoMultipleProveedorDto } from './dto/pago-multiple-proveedor.dto';
import { PatchProveedorCuentaCorrienteDto } from './dto/patch-proveedor-cuenta-corriente.dto';
import { ProveedorCuentaCorrienteService } from './proveedor-cuenta-corriente.service';

@ApiTags('cuenta-corriente')
@ApiBearerAuth('access-token')
@Controller('suppliers/:supplierId/cuenta-corriente')
export class ProveedorCuentaCorrienteController {
  constructor(private readonly service: ProveedorCuentaCorrienteService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Obtener cuenta corriente del proveedor',
    description: 'Paridad GET /api/proveedores/:id/cuenta-corriente',
  })
  getCuenta(@Param('supplierId', ParseUUIDPipe) supplierId: string) {
    return this.service.getCuenta(supplierId);
  }

  @Patch()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Actualizar condiciones de pago de cuenta corriente proveedor',
    description: 'Paridad PATCH /api/proveedores/:id/cuenta-corriente',
  })
  patchCuenta(
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Body() dto: PatchProveedorCuentaCorrienteDto,
  ) {
    return this.service.patchCuenta(supplierId, dto);
  }

  @Get('extracto')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Extracto cuenta corriente proveedor',
    description: 'Paridad GET /api/proveedores/:id/cuenta-corriente/extracto. export=csv para descarga.',
  })
  async getExtracto(
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Query() query: ExtractoQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.getExtracto(supplierId, query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Post('pago-cuenta')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Pago directo a cuenta corriente del proveedor',
    description: 'Paridad POST /api/proveedores/:id/pago-cuenta',
  })
  registrarPagoCuenta(
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Body() dto: PagoCuentaProveedorDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.registrarPagoCuenta(supplierId, dto, user.sub);
  }

  @Post('pago-multiple')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Pago m├║ltiple contra obligaciones del proveedor',
    description: 'Paridad POST /api/proveedores/:id/pago-multiple',
  })
  registrarPagoMultiple(
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Body() dto: PagoMultipleProveedorDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.registrarPagoMultiple(supplierId, dto, user.sub);
  }
}
