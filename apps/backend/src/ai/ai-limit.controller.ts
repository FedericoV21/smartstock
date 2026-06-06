import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { AiLimitService } from './ai-limit.service';

@ApiTags('ai')
@ApiBearerAuth('access-token')
@Controller('ai/limits')
export class AiLimitController {
  constructor(private readonly service: AiLimitService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Consultar l├¡mite mensual de extracciones IA',
    description: 'Paridad GET /api/ia/limite. Requiere m├│dulo ia_precios.',
  })
  getLimit() {
    return this.service.getLimit();
  }
}
