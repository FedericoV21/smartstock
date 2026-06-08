import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { PatchBorradorDto } from './dto/patch-borrador.dto';
import { LectorFacturasBorradoresService } from './lector-facturas-borradores.service';
import { LectorFacturasConfirmService } from './lector-facturas-confirm.service';
import { LectorFacturasTablaOcrService } from './lector-facturas-tabla-ocr.service';
import { LectorFacturasExtractService } from './lector-facturas-extract.service';
import { LectorFacturasLimiteService } from './lector-facturas-limite.service';
import { LectorFacturasLogsService } from './lector-facturas-logs.service';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

@ApiTags('lector-facturas')
@ApiBearerAuth('access-token')
@Controller('lector-facturas')
export class LectorFacturasController {
  constructor(
    private readonly limiteService: LectorFacturasLimiteService,
    private readonly logsService: LectorFacturasLogsService,
    private readonly borradoresService: LectorFacturasBorradoresService,
    private readonly extractService: LectorFacturasExtractService,
    private readonly confirmService: LectorFacturasConfirmService,
    private readonly tablaOcrService: LectorFacturasTablaOcrService,
  ) {}

  @Get('limite')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Límite mensual IA lector', description: 'Paridad GET /api/lector-facturas/limite' })
  getLimite() {
    return this.limiteService.getLimite();
  }

  @Get('logs')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Historial lector facturas', description: 'Paridad GET /api/lector-facturas/logs' })
  getLogs() {
    return this.logsService.listLogs();
  }

  @Get('borradores')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Listar borradores', description: 'Paridad GET /api/lector-facturas/borradores' })
  listBorradores(
    @CurrentUser() user: AccessTokenPayload,
    @Query('limit') limit?: string,
  ) {
    return this.borradoresService.list(user, limit);
  }

  @Get('borradores/:id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Detalle borrador', description: 'Paridad GET /api/lector-facturas/borradores/[id]' })
  getBorrador(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.borradoresService.getById(user, id);
  }

  @Patch('borradores/:id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Guardar borrador', description: 'Paridad PATCH /api/lector-facturas/borradores/[id]' })
  patchBorrador(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchBorradorDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.borradoresService.update(user, id, dto);
  }

  @Delete('borradores/:id')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Descartar borrador', description: 'Paridad DELETE /api/lector-facturas/borradores/[id]' })
  deleteBorrador(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.borradoresService.discard(user, id);
  }

  @Post('extraer')
  @Roles('admin', 'operador')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        archivo: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOperation({
    summary: 'Extraer factura con IA',
    description: 'Paridad POST /api/lector-facturas/extraer',
  })
  @UseInterceptors(
    FilesInterceptor('archivo', 10, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  extraer(@UploadedFiles() files: Express.Multer.File[], @CurrentUser() user: AccessTokenPayload) {
    return this.extractService.extraer(files, user);
  }

  @Post('confirmar')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Confirmar factura importada',
    description: 'Paridad POST /api/lector-facturas/confirmar',
  })
  confirmar(@Body() body: Record<string, unknown>, @CurrentUser() user: AccessTokenPayload) {
    return this.confirmService.confirmar(body, user);
  }

  @Post('tabla-ocr')
  @Roles('admin', 'operador')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        archivo: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary: 'OCR tabla factura (imagen)',
    description: 'Paridad POST /api/lector-facturas/tabla-ocr',
  })
  @UseInterceptors(
    FileInterceptor('archivo', {
      storage: memoryStorage(),
      limits: { fileSize: 12 * 1024 * 1024 },
    }),
  )
  tablaOcr(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AccessTokenPayload) {
    return this.tablaOcrService.extraer(file, user);
  }
}
