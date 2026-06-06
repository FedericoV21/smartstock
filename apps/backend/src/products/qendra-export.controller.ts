import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { ExportQendraBalanzaQueryDto } from './dto/export-qendra-balanza-query.dto';
import { ExportQendraBalanzaDto } from './dto/export-qendra-balanza.dto';
import { QendraExportService } from './qendra-export.service';

@ApiTags('scale-export')
@ApiBearerAuth('access-token')
@Controller()
export class QendraExportController {
  constructor(private readonly qendraExportService: QendraExportService) {}

  @Get('products/export-qendra-balanza')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'CSV Qendra/Systel Max para balanza (pesables o unidad con PLU)',
  })
  @ApiProduces('text/csv')
  exportGet(
    @Query() query: ExportQendraBalanzaQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const categoriaIds = [...(query.categoriaIds ?? [])];
    if (query.categoriaId && !categoriaIds.includes(query.categoriaId)) {
      categoriaIds.push(query.categoriaId);
    }
    const sectorFijo = (query.sectorFijo ?? query.seccion)?.trim() || undefined;
    return this.qendraExportService.exportCsv(
      {
        categoriaIds: categoriaIds.length > 0 ? categoriaIds : undefined,
        productoIds: query.productoIds,
        sectorFijo,
      },
      user,
    );
  }

  @Post('products/export-qendra-balanza')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'CSV Qendra/Systel Max (body JSON con filtros)' })
  @ApiProduces('text/csv')
  exportPost(
    @Body() dto: ExportQendraBalanzaDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.qendraExportService.exportCsv(dto, user);
  }
}
