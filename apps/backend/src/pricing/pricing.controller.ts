import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { GetPricingSuggestionDto } from './dto/get-pricing-suggestion.dto';
import { ListPricingHistorialQueryDto } from './dto/list-pricing-historial-query.dto';
import { PricingService } from './pricing.service';

@ApiTags('pricing')
@ApiBearerAuth('access-token')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get('historial')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Historial paginado de cambios de precio del tenant',
    description:
      'Paridad GET /api/precios/historial. Query: producto_id/productoId, origen, pagina/page, por_pagina/pageSize. Requiere m├│dulo ia_precios.',
  })
  listHistorial(@Query() query: ListPricingHistorialQueryDto) {
    return this.pricingService.listHistorial(query);
  }

  @Post('sugerencias')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Sugerencia de precio de venta por margen configurable',
    description:
      'Si se env├¡a margenObjetivoPct lo usa directo; sino usa margen actual del producto, promedio de categor├¡a o fallback 30%.',
  })
  getSuggestion(@Body() dto: GetPricingSuggestionDto) {
    return this.pricingService.getSuggestion(dto);
  }
}
