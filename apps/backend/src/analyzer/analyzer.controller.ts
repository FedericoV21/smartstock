import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { AnalyzerCuentaCorrienteService } from './analyzer-cuenta-corriente.service';
import { AnalyzerService } from './analyzer.service';
import { AnalyzerSuppliersService } from './suppliers/analyzer-suppliers.service';
import {
  AnalyzerForecastQueryDto,
  AnalyzerMarginQueryDto,
  AnalyzerRadarQueryDto,
  AnalyzerRankingQueryDto,
} from './dto/analyzer-query.dto';
import { AnalyzerCuentaCorrientePagoDto } from './dto/analyzer-cuenta-corriente-pago.dto';
import { CompareSuppliersQueryDto } from './dto/compare-suppliers-query.dto';

@ApiTags('analyzer')
@ApiBearerAuth('access-token')
@Controller('analyzer')
export class AnalyzerController {
  constructor(
    private readonly service: AnalyzerService,
    private readonly suppliersService: AnalyzerSuppliersService,
    private readonly cuentaCorrienteService: AnalyzerCuentaCorrienteService,
  ) {}

  @Get('profitability-dashboard')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'Dashboard rentabilidad (cierre + evoluci├│n)',
    description: 'Paridad GET /api/analizador/cierre',
  })
  getProfitabilityDashboard() {
    return this.service.getProfitabilityDashboard();
  }

  @Get('margin')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'Margen real por producto',
    description: 'Paridad GET /api/analizador/margen',
  })
  getMargin(@Query() query: AnalyzerMarginQueryDto) {
    return this.service.getMargin(query);
  }

  @Get('ranking')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'Ranking BCG de productos',
    description: 'Paridad GET /api/analizador/ranking',
  })
  getRanking(@Query() query: AnalyzerRankingQueryDto) {
    return this.service.getRanking(query);
  }

  @Get('forecast')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'Forecast de reposici├│n',
    description: 'Paridad GET /api/analizador/forecast',
  })
  getForecast(@Query() query: AnalyzerForecastQueryDto) {
    return this.service.getForecast(query);
  }

  @Get('inflation-radar')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'Radar de inflaci├│n (cross-tenant)',
    description: 'Paridad GET /api/analizador/radar',
  })
  getInflationRadar(@Query() query: AnalyzerRadarQueryDto) {
    return this.service.getInflationRadar(query);
  }

  @Get('opportunity-alerts')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'Alertas de oportunidad (listas proveedor)',
    description: 'Paridad GET /api/analizador/alertas/oportunidades',
  })
  getOpportunityAlerts() {
    return this.service.getOpportunityAlerts();
  }

  @Get('suppliers/compare')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'Comparar proveedores por score',
    description: 'Paridad GET /api/analizador/proveedores/comparar',
  })
  compareSuppliers(@Query() query: CompareSuppliersQueryDto) {
    return this.suppliersService.comparar(query.producto_id, query.categoria_id);
  }

  @Get('suppliers/:id/profile')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'Perfil de proveedor (historial listas + tendencia)',
    description: 'Paridad GET /api/analizador/proveedores/[id]/perfil',
  })
  supplierProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.perfil(id);
  }

  @Get('cuenta-corriente')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Resumen CC cliente para analizador',
    description: 'Paridad GET /api/analizador/cuenta-corriente?cliente_id=',
  })
  @ApiQuery({ name: 'cliente_id', required: true })
  cuentaCorrienteResumen(@Query('cliente_id') clienteId: string) {
    return this.cuentaCorrienteService.getResumen(clienteId);
  }

  @Post('cuenta-corriente/pago')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Registrar pago CC desde analizador',
    description: 'Paridad POST /api/analizador/cuenta-corriente/pago',
  })
  cuentaCorrientePago(
    @Body() dto: AnalyzerCuentaCorrientePagoDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.cuentaCorrienteService.registrarPago(dto, user.sub);
  }
}
