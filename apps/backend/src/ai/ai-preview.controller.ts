import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { AiPreviewService } from './ai-preview.service';
import { AiPreviewDto } from './dto/ai-preview.dto';

@ApiTags('ai')
@ApiBearerAuth('access-token')
@Controller('ai/preview')
export class AiPreviewController {
  constructor(private readonly service: AiPreviewService) {}

  @Post()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Previsualizar cambios de precio tras importaci├│n IA',
    description: 'Paridad POST /api/ia/previsualizar. Calcula cambios y sugerencias de margen.',
  })
  preview(@Body() dto: AiPreviewDto) {
    return this.service.preview(dto);
  }
}
