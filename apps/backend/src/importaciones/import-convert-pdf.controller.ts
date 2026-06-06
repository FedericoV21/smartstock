import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import { Roles } from '../auth/decorators/roles.decorator';
import { ImportConvertPdfService } from './import-convert-pdf.service';
import { PDF_TO_TABLE_MAX_BYTES } from './utils/pdf-upload-limits';

@ApiTags('importaciones')
@ApiBearerAuth('access-token')
@Controller('importaciones/convert-pdf')
export class ImportConvertPdfController {
  constructor(private readonly service: ImportConvertPdfService) {}

  @Post()
  @Roles('admin', 'operador')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['archivo'],
      properties: { archivo: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Convertir PDF con texto seleccionable a tabla',
    description:
      'Paridad POST /api/importar/convertir-pdf. Extrae headers y filas desde columnas posicionadas (sin OCR). Requiere m├│dulo importador_excel o ia_precios.',
  })
  @UseInterceptors(
    FileInterceptor('archivo', {
      storage: memoryStorage(),
      limits: { fileSize: PDF_TO_TABLE_MAX_BYTES },
    }),
  )
  convert(@UploadedFile() file: Express.Multer.File) {
    return this.service.convert(file);
  }
}
