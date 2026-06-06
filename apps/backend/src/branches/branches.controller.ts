import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { SetActiveBranchDto } from './dto/set-active-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@ApiTags('branches')
@ApiBearerAuth('access-token')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar sucursales del tenant' })
  list() {
    return this.branchesService.list();
  }

  @Get('active')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Contexto de sucursal activa (lista + resoluci├│n)' })
  getActive(@CurrentUser() user: AccessTokenPayload) {
    return this.branchesService.getActiveContext(user);
  }

  @Post('active')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Seleccionar y persistir sucursal operativa del usuario' })
  setActive(@Body() dto: SetActiveBranchDto, @CurrentUser() user: AccessTokenPayload) {
    return this.branchesService.setActive(dto, user);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Crear sucursal' })
  create(@Body() dto: CreateBranchDto) {
    return this.branchesService.create(dto);
  }

  @Get(':id')
  @Roles('admin', 'operador', 'visor')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.branchesService.getById(id);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.branchesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar sucursal (no principal)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.branchesService.remove(id);
  }
}
