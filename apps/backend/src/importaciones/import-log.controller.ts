import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { ListImportLogsQueryDto } from './dto/list-import-logs-query.dto';
import { RevertImportLogDto } from './dto/revert-import-log.dto';
import { ImportLogService } from './import-log.service';

@ApiTags('importaciones')
@ApiBearerAuth('access-token')
@Controller('importaciones/logs')
export class ImportLogController {
  constructor(private readonly importLogService: ImportLogService) {}

  @Get()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Historial de importaciones',
    description: 'Paridad GET /api/importar/logs. Filtra por sucursal operativa, fechas y proveedor.',
  })
  list(@Query() query: ListImportLogsQueryDto) {
    return this.importLogService.list(query);
  }

  @Get(':id/file')
  @Roles('admin', 'operador')
  @ApiProduces('application/octet-stream')
  @ApiOperation({
    summary: 'Descargar archivo de una importaci├│n',
    description: 'Paridad GET /api/importar/logs/[id]/archivo. Sirve bytes desde importacion_archivo si existe.',
  })
  @Header('Cache-Control', 'no-store')
  async downloadFile(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.importLogService.downloadFile(id);
    if (result instanceof StreamableFile) return result;
    return result;
  }

  @Post(':id/revert')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Revertir una carga de importaci├│n',
    description:
      'Paridad POST /api/importar/logs/[id]/revertir. Usa snapshots de importacion_producto_snapshot.',
  })
  revert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevertImportLogDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.importLogService.revert(id, dto.motivo, user);
  }
}
