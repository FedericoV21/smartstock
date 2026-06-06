import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import {
  CrearBorradorPosDto,
  EliminarBorradorQueryDto,
  PosBuscarProductosQueryDto,
  PosBuscarPromocionesQueryDto,
  PosCatalogoBusquedaQueryDto,
  PosProductosPorIdsDto,
} from './dto/pos.dto';
import { PosService } from './pos.service';

@ApiTags('pos')
@ApiBearerAuth('access-token')
@Controller('pos')
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get('buscar-productos')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'B├║squeda r├ípida de productos POS',
    description: 'Paridad GET /api/pos/buscar-productos',
  })
  buscarProductos(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: PosBuscarProductosQueryDto,
  ) {
    return this.posService.buscarProductos(user, query);
  }

  @Get('catalogo-busqueda')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Cat├ílogo paginado para POS',
    description: 'Paridad GET /api/pos/catalogo-busqueda',
  })
  catalogoBusqueda(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: PosCatalogoBusquedaQueryDto,
  ) {
    return this.posService.catalogoBusqueda(user, query);
  }

  @Post('productos-por-ids')
  @Roles('admin', 'operador', 'visor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hidratar productos por IDs o selecciones',
    description: 'Paridad POST /api/pos/productos-por-ids',
  })
  productosPorIds(@CurrentUser() user: AccessTokenPayload, @Body() dto: PosProductosPorIdsDto) {
    return this.posService.productosPorIds(user, dto);
  }

  @Get('buscar-promociones')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Buscar combos vigentes',
    description: 'Paridad GET /api/pos/buscar-promociones',
  })
  buscarPromociones(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: PosBuscarPromocionesQueryDto,
  ) {
    return this.posService.buscarPromociones(user, query);
  }

  @Get('proveedores')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Listado de proveedores activos',
    description: 'Paridad GET /api/pos/proveedores',
  })
  listProveedores(@CurrentUser() user: AccessTokenPayload) {
    return this.posService.listProveedores(user);
  }

  @Post('comprobante-borrador')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear comprobante borrador POS',
    description: 'Paridad POST /api/pos/comprobante-borrador',
  })
  crearBorrador(@CurrentUser() user: AccessTokenPayload, @Body() dto: CrearBorradorPosDto) {
    return this.posService.crearBorrador(user, dto);
  }

  @Delete('comprobante-borrador')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Eliminar comprobante borrador',
    description: 'Paridad DELETE /api/pos/comprobante-borrador?id=ÔÇª',
  })
  eliminarBorrador(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: EliminarBorradorQueryDto,
  ) {
    return this.posService.eliminarBorrador(user, query.id, query.sucursal_id);
  }
}
