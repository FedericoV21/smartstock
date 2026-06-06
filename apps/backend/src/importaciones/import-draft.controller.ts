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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { ListImportDraftsQueryDto } from './dto/list-import-drafts-query.dto';
import { PrepareImportDraftConfirmationDto } from './dto/prepare-import-draft-confirmation.dto';
import { ReplaceImportDraftChunksDto } from './dto/replace-import-draft-chunks.dto';
import { UpsertImportDraftDto } from './dto/upsert-import-draft.dto';
import { ImportDraftService } from './import-draft.service';
import { IMPORT_DRAFT_MAX_BYTES } from './utils/import-draft-payload.util';

@ApiTags('importaciones')
@ApiBearerAuth('access-token')
@Controller('importaciones/drafts')
export class ImportDraftController {
  constructor(private readonly importDraftService: ImportDraftService) {}

  @Get()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Listar borradores activos de importaci├│n',
    description: 'Paridad GET /api/importar/borradores. Operadores ven solo los propios; admin ve todos.',
  })
  list(@Query() query: ListImportDraftsQueryDto, @CurrentUser() user: AccessTokenPayload) {
    return this.importDraftService.list(query, user);
  }

  @Post()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Crear borrador de importaci├│n',
    description: 'Paridad POST /api/importar/borradores. Requiere sucursal operativa en contexto.',
  })
  create(@Body() dto: UpsertImportDraftDto, @CurrentUser() user: AccessTokenPayload) {
    return this.importDraftService.create(dto, user);
  }

  @Get(':id')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Detalle de borrador con payload y filas',
    description: 'Paridad GET /api/importar/borradores/[id].',
  })
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.importDraftService.getById(id, user);
  }

  @Patch(':id')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Actualizar metadata/payload del borrador',
    description: 'Paridad PATCH /api/importar/borradores/[id].',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertImportDraftDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.importDraftService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Eliminar borrador',
    description: 'Paridad DELETE /api/importar/borradores/[id].',
  })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.importDraftService.remove(id, user);
  }

  @Put(':id/chunks')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Reemplazar filas del borrador (chunks de 500)',
    description: 'Paridad PUT /api/importar/borradores/[id]/chunks.',
  })
  replaceChunks(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceImportDraftChunksDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.importDraftService.replaceChunks(id, dto, user);
  }

  @Post(':id/file')
  @Roles('admin', 'operador')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Guardar archivo original del borrador',
    description: 'Paridad POST /api/importar/borradores/[id]/archivo. M├íx. 20 MB (.xlsx, .xls, .csv, PDF).',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: IMPORT_DRAFT_MAX_BYTES },
    }),
  )
  uploadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.importDraftService.uploadFile(id, file, user);
  }

  @Post(':id/prepare-confirmation')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Preparar confirmaci├│n de importaci├│n',
    description:
      'Paridad POST /api/importar/borradores/[id]/preparar-confirmacion. Copia archivo a importacion_archivo y devuelve cargaId.',
  })
  prepareConfirmation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrepareImportDraftConfirmationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.importDraftService.prepareConfirmation(id, dto, user);
  }
}
