import { Body, Controller, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { ReplaceWorkflowTransicionesDto } from './dto/replace-workflow-transiciones.dto';
import { PedidoWorkflowService } from './pedido-workflow.service';

@ApiTags('pedidos')
@ApiBearerAuth('access-token')
@Controller('pedidos/workflow-transiciones')
export class PedidoWorkflowTransicionesController {
  constructor(private readonly workflowService: PedidoWorkflowService) {}

  @Put()
  @Roles('admin')
  @ApiOperation({
    summary: 'Reemplazar transiciones de workflow del tenant',
    description:
      'Paridad PUT /api/pedidos/workflow-transiciones. Borra todas las aristas e inserta el set enviado. Solo admin.',
  })
  replace(@Body() dto: ReplaceWorkflowTransicionesDto) {
    return this.workflowService.replaceTransiciones(dto.transiciones);
  }
}
