import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { ArcaTrayService } from './arca-tray.service';
import { ComprobanteRetryArcaService } from './comprobante-retry-arca.service';
import { ComprobanteVoidService } from './comprobante-void.service';
import { ArcaTrayQueryDto } from './dto/arca-tray-query.dto';
import { EmitComprobanteDto } from './dto/emit-comprobante.dto';
import { ListComprobantesQueryDto } from './dto/list-comprobantes-query.dto';
import { VoidComprobanteDto } from './dto/void-comprobante.dto';
import { CompraProveedorManualDto } from './dto/compra-proveedor-manual.dto';
import { CompraProveedorManualService } from './compra-proveedor-manual.service';
import { FacturacionService } from './facturacion.service';

@ApiTags('facturacion')
@ApiBearerAuth('access-token')
@Controller('facturacion')
export class FacturacionController {
  constructor(
    private readonly facturacionService: FacturacionService,
    private readonly comprobanteVoidService: ComprobanteVoidService,
    private readonly arcaTrayService: ArcaTrayService,
    private readonly comprobanteRetryArcaService: ComprobanteRetryArcaService,
    private readonly compraProveedorManualService: CompraProveedorManualService,
  ) {}

  @Get('comprobantes')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar comprobantes del tenant (paginado)' })
  list(@Query() query: ListComprobantesQueryDto) {
    return this.facturacionService.list(query);
  }

  @Get('arca-tray')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Bandeja ARCA: comprobantes fiscales pendientes o en error',
  })
  listArcaTray(@Query() query: ArcaTrayQueryDto) {
    return this.arcaTrayService.listTray(query.sucursalId);
  }

  @Get('arca-tray/alert')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Contador para banner: comprobantes ARCA a resolver' })
  arcaTrayAlert(@Query() query: ArcaTrayQueryDto) {
    return this.arcaTrayService.getAlertCount(query.sucursalId);
  }

  @Get('comprobantes/:id')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Detalle de comprobante con ├¡tems' })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.facturacionService.getById(id);
  }

  @Get('comprobantes/:id/pdf')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Descargar PDF del comprobante (generado on-the-fly)' })
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadPdf(@Param('id', ParseUUIDPipe) id: string) {
    const { buffer, filename } = await this.facturacionService.downloadPdf(id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post('comprobantes/:id/pdf/regenerate')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Regenerar PDF y subir a storage S3 si est├í configurado',
    description: 'Actualiza `pdf_url` cuando `PDF_STORAGE_ENABLED` y credenciales S3 est├ín definidas.',
  })
  regeneratePdf(@Param('id', ParseUUIDPipe) id: string) {
    return this.facturacionService.regeneratePdf(id);
  }

  @Post('compra-proveedor-manual')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Registrar compra a proveedor cargada manualmente',
    description:
      'Crea comprobante importado (compra), ├¡tems, entrada de stock opcional, actualizaci├│n de costos y registro en factura_importada_aplicacion.',
  })
  compraProveedorManual(
    @Body() dto: CompraProveedorManualDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.compraProveedorManualService.registrar(dto, user.sub);
  }

  @Post('comprobantes')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Emitir comprobante (core)',
    description:
      'Emite comprobante en transacci├│n: numeraci├│n, cabecera, items y movimiento de stock seg├║n tipo.',
  })
  emitir(@Body() dto: EmitComprobanteDto, @CurrentUser() user: AccessTokenPayload) {
    return this.facturacionService.emitir(dto, user.sub);
  }

  @Post('comprobantes/:id/retry-arca')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Reintentar autorizaci├│n ARCA (CAE) sobre comprobante existente',
    description:
      'No mueve stock ni asigna numeraci├│n nueva. Estados admitidos: error_arca, pendiente_arca (o emitido sin CAE v├ílido).',
  })
  retryArca(@Param('id', ParseUUIDPipe) id: string) {
    return this.comprobanteRetryArcaService.retryArca(id);
  }

  @Post('comprobantes/:id/void-without-cae')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Anular comprobante sin CAE AFIP v├ílido',
    description:
      'Revierte stock, marca estado anulado y registra motivo. No aplica a compras ni comprobantes con CAE v├ílido.',
  })
  voidWithoutCae(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidComprobanteDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.comprobanteVoidService.anularSinCae(id, dto.motivo, user.sub);
  }

  @Post('comprobantes/:id/revert-imported')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Revertir factura de compra importada',
    description:
      'Solo compras en estado importado: revierte entradas de stock y anula el comprobante.',
  })
  revertImported(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidComprobanteDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.comprobanteVoidService.revertirImportada(id, dto.motivo, user.sub);
  }
}
