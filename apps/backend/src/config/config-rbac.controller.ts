import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { ConfigRolesService } from './config-roles.service';
import { ConfigUsersRbacService } from './config-users-rbac.service';
import { CreateRolDto, PatchRolDto } from './dto/config-roles.dto';
import {
  ChangeUserPinDto,
  CreateLocalUserDto,
  PatchUserPermisosExtraDto,
  PutUserPedidosWorkflowEstadosDto,
  PutUserSucursalesDto,
} from './dto/config-users-rbac.dto';

@ApiTags('config')
@ApiBearerAuth('access-token')
@Controller('config')
@Roles('admin')
export class ConfigRbacController {
  constructor(
    private readonly rolesService: ConfigRolesService,
    private readonly usersRbacService: ConfigUsersRbacService,
  ) {}

  @Get('roles')
  @ApiOperation({
    summary: 'Listar roles y permisos del tenant',
    description: 'Paridad GET /api/configuracion/roles',
  })
  listRoles() {
    return this.rolesService.listRoles();
  }

  @Post('roles')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Crear rol personalizado',
    description: 'Paridad POST /api/configuracion/roles',
  })
  createRole(@Body() dto: CreateRolDto) {
    return this.rolesService.createRole(dto);
  }

  @Patch('roles/:id')
  @ApiOperation({
    summary: 'Editar rol y permisos',
    description: 'Paridad PATCH /api/configuracion/roles/[id]',
  })
  patchRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchRolDto) {
    return this.rolesService.patchRole(id, dto);
  }

  @Post('users/local')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Crear usuario local (username + PIN en PostgreSQL)',
    description:
      'Paridad POST /api/configuracion/usuarios/local. Credencial en usuario_credencial_local; login vía NB-AUTH-010.',
  })
  createLocalUser(@Body() dto: CreateLocalUserDto) {
    return this.usersRbacService.createLocalUser(dto);
  }

  @Get('users/:id/sucursales')
  @ApiOperation({
    summary: 'Sucursales asignadas al usuario',
    description: 'Paridad GET /api/configuracion/usuarios/[id]/sucursales',
  })
  getUserSucursales(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersRbacService.getUserSucursales(id);
  }

  @Put('users/:id/sucursales')
  @ApiOperation({
    summary: 'Asignar sucursales al usuario',
    description: 'Paridad PUT /api/configuracion/usuarios/[id]/sucursales',
  })
  putUserSucursales(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PutUserSucursalesDto,
  ) {
    return this.usersRbacService.putUserSucursales(id, dto);
  }

  @Post('users/:id/pin')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cambiar PIN de usuario local',
    description: 'Paridad POST /api/configuracion/usuarios/[id]/pin',
  })
  changeUserPin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeUserPinDto) {
    return this.usersRbacService.changeUserPin(id, dto);
  }

  @Get('users/:id/permisos-extra')
  @ApiOperation({
    summary: 'Permisos extra asignables al usuario',
    description: 'Paridad GET /api/configuracion/usuarios/[id]/permisos-extra',
  })
  getUserPermisosExtra(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersRbacService.getUserPermisosExtra(id);
  }

  @Patch('users/:id/permisos-extra')
  @ApiOperation({
    summary: 'Actualizar permisos extra del usuario',
    description: 'Paridad PATCH /api/configuracion/usuarios/[id]/permisos-extra',
  })
  patchUserPermisosExtra(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchUserPermisosExtraDto,
  ) {
    return this.usersRbacService.patchUserPermisosExtra(id, dto);
  }

  @Get('users/:id/pedidos-workflow-estados')
  @ApiOperation({
    summary: 'Estados workflow pedidos visibles para el usuario',
    description: 'Paridad GET /api/configuracion/usuarios/[id]/pedidos-workflow-estados',
  })
  getUserPedidosWorkflowEstados(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersRbacService.getUserPedidosWorkflowEstados(id);
  }

  @Put('users/:id/pedidos-workflow-estados')
  @ApiOperation({
    summary: 'Asignar estados workflow pedidos al usuario',
    description: 'Paridad PUT /api/configuracion/usuarios/[id]/pedidos-workflow-estados',
  })
  putUserPedidosWorkflowEstados(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PutUserPedidosWorkflowEstadosDto,
  ) {
    return this.usersRbacService.putUserPedidosWorkflowEstados(id, dto);
  }
}
