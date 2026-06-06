import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { CreateWorkflowEstadoDto } from './dto/create-workflow-estado.dto';
import { ListWorkflowEstadosQueryDto } from './dto/list-workflow-estados-query.dto';
import { UpdateWorkflowEstadoDto } from './dto/update-workflow-estado.dto';
import { PedidoWorkflowService } from './pedido-workflow.service';

@ApiTags('pedidos')
@ApiBearerAuth('access-token')
@Controller('pedidos/workflow-estados')
export class PedidoWorkflowController {
  constructor(private readonly workflowService: PedidoWorkflowService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Listar estados de workflow y transiciones del tenant',
    description:
      'Paridad GET /api/pedidos/workflow-estados. Query for_config=1 incluye inactivos (solo admin). Requiere m├│dulo pedidos.',
  })
  list(@Query() query: ListWorkflowEstadosQueryDto, @CurrentUser() user: AccessTokenPayload) {
    const isSuperAdmin = user.es_super_admin === true || user.isSuperAdmin === true;
    if (query.forConfig && resolveAppRole(user) !== 'admin' && !isSuperAdmin) {
      throw new ForbiddenException('Solo el administrador puede configurar estados de pedidos.');
    }
    return this.workflowService.list(query);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({
    summary: 'Crear estado de workflow',
    description: 'Paridad POST /api/pedidos/workflow-estados. Solo admin.',
  })
  create(@Body() dto: CreateWorkflowEstadoDto) {
    return this.workflowService.create(dto);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Actualizar estado de workflow',
    description: 'Paridad PATCH /api/pedidos/workflow-estados/:id. Solo admin.',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkflowEstadoDto) {
    return this.workflowService.update(id, dto);
  }
}
