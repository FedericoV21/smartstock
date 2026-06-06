import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { ActiveMapDto } from './dto/active-map.dto';
import { ListPromocionesQueryDto } from './dto/list-promociones-query.dto';
import { PatchPromocionDto } from './dto/patch-promocion.dto';
import { PromotionsService } from './promotions.service';

@ApiTags('promotions')
@ApiBearerAuth('access-token')
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar promociones visibles en la sucursal activa' })
  list(@Query() query: ListPromocionesQueryDto) {
    return this.promotionsService.list(query);
  }

  @Post('active-map')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Mapa de promociones vigentes por producto (POS / emisi├│n)',
    description: 'Paridad front: POST /api/promociones/mapa-vigente',
  })
  activeMap(@Body() dto: ActiveMapDto) {
    return this.promotionsService.buildActiveMap(dto.productoIds, dto.sucursalId);
  }

  @Get(':id')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Detalle de promoci├│n con productos y combo' })
  getOne(@Param('id', ParseUUIDPipe) id: string, @Query('sucursalId') sucursalId?: string) {
    return this.promotionsService.getById(id, sucursalId);
  }

  @Post()
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Crear promoci├│n' })
  create(@Body() body: Record<string, unknown>) {
    return this.promotionsService.create(body);
  }

  @Put(':id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Actualizar promoci├│n' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.promotionsService.update(id, body);
  }

  @Patch(':id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Activar/desactivar promoci├│n' })
  patch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchPromocionDto) {
    return this.promotionsService.patchActiva(id, dto.activa);
  }

  @Delete(':id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Desactivar promoci├│n (soft delete)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.promotionsService.deactivate(id);
  }
}
