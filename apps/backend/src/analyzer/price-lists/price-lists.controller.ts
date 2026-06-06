import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/access-token-payload.interface';
import { ApplyPriceListDto } from './dto/apply-price-list.dto';
import { ConfirmPriceListDto } from './dto/confirm-price-list.dto';
import { ListPriceListsQueryDto } from './dto/list-price-lists-query.dto';
import {
  CloneBranchDto,
  CompareListsDto,
  CompareTemporalQueryDto,
  PatchSimulateDto,
} from './dto/price-list-compare-simulate.dto';
import { PriceListPreviewService } from './price-list-preview.service';
import { PriceListReportService } from './price-list-report.service';
import { PriceListsService } from './price-lists.service';
import { MAX_ARCHIVO_LISTA_BYTES } from './utils/extraer-lista.constants';

@ApiTags('analyzer')
@ApiBearerAuth('access-token')
@Controller('analyzer/price-lists')
export class PriceListsController {
  constructor(
    private readonly service: PriceListsService,
    private readonly previewService: PriceListPreviewService,
    private readonly reportService: PriceListReportService,
  ) {}

  @Get()
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'Listar listas de precios',
    description: 'Paridad GET /api/analizador/listas',
  })
  list(@Query() query: ListPriceListsQueryDto) {
    return this.service.list(query);
  }

  @Post('preview')
  @Roles('admin', 'operador')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['archivo', 'proveedor_id'],
      properties: {
        archivo: { type: 'string', format: 'binary' },
        proveedor_id: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiOperation({
    summary: 'Preview lista: extrae ├¡tems y sube archivo',
    description: 'Paridad POST /api/analizador/listas/preview. Excel/CSV sin IA; PDF/imagen con ia_precios.',
  })
  @UseInterceptors(
    FileInterceptor('archivo', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ARCHIVO_LISTA_BYTES },
    }),
  )
  preview(
    @CurrentUser() user: AccessTokenPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body('proveedor_id') proveedorId: string,
  ) {
    return this.previewService.preview(user, file, proveedorId);
  }

  @Post('confirm')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Confirmar lista con ├¡tems pre-extra├¡dos',
    description:
      'Paridad POST /api/analizador/listas/confirm. Tras preview o JSON manual.',
  })
  confirm(@Body() dto: ConfirmPriceListDto) {
    return this.service.confirm(dto);
  }

  @Get('compare/temporal')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'Comparaci├│n temporal de listas del mismo proveedor',
    description: 'Paridad GET /api/analizador/listas/comparar?proveedor_id=',
  })
  compareTemporal(@Query() query: CompareTemporalQueryDto) {
    return this.service.compararTemporal(query.proveedor_id);
  }

  @Post('compare')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Comparar 2ÔÇô5 listas de distintos proveedores',
    description: 'Paridad POST /api/analizador/listas/comparar',
  })
  compareLists(@Body() dto: CompareListsDto, @CurrentUser() user: AccessTokenPayload) {
    return this.service.compararListas(dto, user.sub);
  }

  @Get(':id')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: 'Detalle de lista con ├¡tems',
    description: 'Paridad GET /api/analizador/listas/[id]',
  })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(id);
  }

  @Post(':id/matching')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Matching c├│digo/nombre (+ IA fuzzy si ia_precios)',
    description: 'Paridad POST /api/analizador/listas/[id]/matching',
  })
  runMatching(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.runMatching(id, user.sub);
  }

  @Post(':id/analysis')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'An├ílisis de variaci├│n y m├írgenes',
    description: 'Paridad POST /api/analizador/listas/[id]/analisis',
  })
  runAnalysis(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.runAnalysis(id);
  }

  @Post(':id/report')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Reporte ejecutivo IA de la lista',
    description: 'Paridad POST /api/analizador/listas/[id]/reporte',
  })
  generarReporte(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.reportService.generarReporte(id, user.sub);
  }

  @Post(':id/apply')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Aplicar precios al cat├ílogo',
    description: 'Paridad POST /api/analizador/listas/[id]/aplicar',
  })
  apply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyPriceListDto) {
    return this.service.apply(id, dto);
  }

  @Get(':id/simulate')
  @Roles('admin', 'visor')
  @ApiOperation({
    summary: '├ìtems listos para simular precios de venta',
    description: 'Paridad GET /api/analizador/listas/[id]/simular',
  })
  getSimulate(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getSimulate(id);
  }

  @Patch(':id/simulate')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Guardar precios decididos en simulaci├│n',
    description: 'Paridad PATCH /api/analizador/listas/[id]/simular',
  })
  patchSimulate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchSimulateDto) {
    return this.service.patchSimulate(id, dto);
  }

  @Post(':id/clone-branch')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Clonar lista a otra sucursal (sin match de productos)',
    description: 'Paridad POST /api/analizador/listas/[id]/clonar-sucursal',
  })
  cloneBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloneBranchDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.cloneBranch(id, dto, user.sub);
  }
}
