import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { BranchTransfersService } from './branch-transfers.service';
import { CreateBranchTransferDto } from './dto/create-branch-transfer.dto';
import {
  ListBranchTransfersQueryDto,
  PreviewBranchTransferQueryDto,
} from './dto/list-branch-transfers-query.dto';

@ApiTags('branch-transfers')
@ApiBearerAuth('access-token')
@Controller('inventory/branch-transfers')
export class BranchTransfersController {
  constructor(private readonly branchTransfersService: BranchTransfersService) {}

  @Get('preview')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Vista previa de stock origen/destino antes de transferir' })
  preview(@Query() query: PreviewBranchTransferQueryDto) {
    return this.branchTransfersService.preview(query);
  }

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Transferencias pendientes de recepci├│n en un dep├│sito' })
  listPending(
    @Query() query: ListBranchTransfersQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.branchTransfersService.listPending(query.sucursalDestinoId, user);
  }

  @Post()
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Enviar transferencia (descuenta stock en origen, queda pendiente en destino)',
  })
  create(@Body() dto: CreateBranchTransferDto, @CurrentUser() user: AccessTokenPayload) {
    return this.branchTransfersService.create(dto, user);
  }

  @Post(':id/receive')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Aceptar recepci├│n en dep├│sito destino (registra entrada)' })
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.branchTransfersService.receive(id, user);
  }
}
