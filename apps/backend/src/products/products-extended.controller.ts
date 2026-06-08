import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import {
  CloneBranchDto,
  PluFueraDeRangoQueryDto,
  PutGananciaTramosDto,
} from './dto/products-extended.dto';
import { ProductsExtendedService } from './products-extended.service';

@ApiTags('products')
@ApiBearerAuth('access-token')
@Roles('admin', 'operador', 'visor')
@Controller('products')
export class ProductsExtendedController {
  constructor(private readonly service: ProductsExtendedService) {}

  @Get('plu-out-of-range')
  @ApiOperation({
    summary: 'Conteo de PLU que exceden dígitos de balanza',
    description: 'Paridad GET /api/productos/plu-fuera-de-rango.',
  })
  pluFueraDeRango(@Query() query: PluFueraDeRangoQueryDto) {
    return this.service.countPluFueraDeRango(query);
  }

  @Post('clone-branch')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Clonar productos a otra sucursal',
    description: 'Paridad POST /api/productos/clonar-sucursal.',
  })
  cloneBranch(@Body() dto: CloneBranchDto, @CurrentUser() user: AccessTokenPayload) {
    return this.service.cloneBranch(dto, user);
  }

  @Get(':id/margin-tiers')
  @ApiOperation({
    summary: 'Tramos de ganancia por cantidad del producto',
    description: 'Paridad GET /api/productos/:id/ganancia-tramos.',
  })
  getMarginTiers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.getGananciaTramos(id, user);
  }

  @Put(':id/margin-tiers')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Reemplazar tramos de ganancia del producto',
    description: 'Paridad PUT /api/productos/:id/ganancia-tramos.',
  })
  putMarginTiers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PutGananciaTramosDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.putGananciaTramos(id, dto, user);
  }

  @Get(':id/promotions')
  @ApiOperation({
    summary: 'Promociones vinculadas al producto',
    description: 'Paridad GET /api/productos/:id/promociones.',
  })
  listPromotions(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listPromocionesProducto(id);
  }
}
