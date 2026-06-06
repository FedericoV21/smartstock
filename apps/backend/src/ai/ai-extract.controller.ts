import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { AiExtractService } from './ai-extract.service';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

@ApiTags('ai')
@ApiBearerAuth('access-token')
@Controller('ai/extract')
export class AiExtractController {
  constructor(private readonly service: AiExtractService) {}

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
    summary: 'Extraer lista de precios con IA (PDF/imagen)',
    description:
      'Paridad POST /api/ia/extraer. Gemini/OpenRouter vision. Cuenta uso en importacion_log (origen ia_pdf).',
  })
  @UseInterceptors(
    FileInterceptor('archivo', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  extract(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AccessTokenPayload) {
    return this.service.extract(file, user);
  }
}
