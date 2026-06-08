import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import {
  CustomerDebtQueryDto,
  ExtractoClienteReportQueryDto,
  ExtractoProveedorReportQueryDto,
  PosConsumerSalesQueryDto,
  RecibosQueryDto,
  ReportPeriodQueryDto,
  SalesByProductQueryDto,
  SupplierReplenishmentQueryDto,
  SupplierSpendQueryDto,
} from './dto/report-period-query.dto';
import { ReportsAdvancedService } from './reports-advanced.service';
import { ReportsExtendedService } from './reports-extended.service';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly advancedService: ReportsAdvancedService,
    private readonly extendedService: ReportsExtendedService,
  ) {}

  @Get('summary')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Resumen KPIs del per├¡odo',
    description: 'Paridad GET /api/reportes/resumen. Requiere facturador_simple.',
  })
  async getSummary(@Query() query: ReportPeriodQueryDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.getSummary(query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Get('libro-iva')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Libro IVA ventas',
    description: 'Paridad GET /api/reportes/libro-iva',
  })
  async getLibroIva(@Query() query: ReportPeriodQueryDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.getLibroIva(query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Get('sales-period-summary')
  @Roles('admin')
  @ApiOperation({
    summary: 'Resumen ventas/costos/ganancia del per├¡odo',
    description: 'Paridad GET /api/reportes/resumen-venta-periodo. Solo admin.',
  })
  getSalesPeriodSummary(
    @Query() query: ReportPeriodQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.getSalesPeriodSummary(query, user);
  }

  @Get('sales-by-product')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Ventas por art├¡culo',
    description: 'Paridad GET /api/reportes/ventas-articulo',
  })
  async getSalesByProduct(
    @Query() query: SalesByProductQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.getSalesByProduct(query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Get('pos-consumer-sales')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Ventas POS por consumidor (tickets)',
    description: 'Paridad GET /api/reportes/ventas-consumidor. Requiere facturador_pos.',
  })
  async getPosConsumerSales(
    @Query() query: PosConsumerSalesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.getPosConsumerSales(query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Get('supplier-replenishment')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Sugerencia de reposici├│n por proveedor',
    description: 'Paridad GET /api/reportes/reposicion-proveedor',
  })
  async getSupplierReplenishment(
    @Query() query: SupplierReplenishmentQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.advancedService.getSupplierReplenishment(query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Get('net-profits')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Ganancias netas del per├¡odo',
    description: 'Paridad GET /api/reportes/ganancias-netas',
  })
  async getNetProfits(@Query() query: ReportPeriodQueryDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.advancedService.getNetProfits(query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Get('supplier-spend')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Gasto por proveedor vs per├¡odo anterior',
    description: 'Paridad GET /api/reportes/proveedores-gasto',
  })
  async getSupplierSpend(
    @Query() query: SupplierSpendQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.advancedService.getSupplierSpend(query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Get('customer-debt')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Deuda de clientes',
    description: 'Paridad GET /api/reportes/clientes-deuda (sin aging por factura hasta cobranza_factura)',
  })
  async getCustomerDebt(
    @Query() query: CustomerDebtQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.advancedService.getCustomerDebt(query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Get('recibos')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Reporte de recibos y cobros',
    description: 'Paridad GET /api/reportes/recibos.',
  })
  async getRecibos(@Query() query: RecibosQueryDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.extendedService.getRecibos(query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Get('extracto-cuenta-corriente')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Extracto CC por cliente (reporte)',
    description: 'Paridad GET /api/reportes/extracto-cuenta-corriente. Requiere cliente_id.',
  })
  async getExtractoCuentaCorriente(
    @Query() query: ExtractoClienteReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.extendedService.getExtractoCuentaCorriente(query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }

  @Get('extracto-cuenta-corriente-proveedor')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Extracto CC por proveedor (reporte)',
    description: 'Paridad GET /api/reportes/extracto-cuenta-corriente-proveedor. Requiere proveedor_id.',
  })
  async getExtractoCuentaCorrienteProveedor(
    @Query() query: ExtractoProveedorReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.extendedService.getExtractoCuentaCorrienteProveedor(query);
    if ('csv' in result) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    return result;
  }
}
