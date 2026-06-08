import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { UsersService } from '../users/users.service';
import {
  CreatePasarelaIntegracionDto,
  DeletePasarelaIntegracionQueryDto,
  PasarelaIntegracionQueryDto,
  PatchPasarelaIntegracionDto,
  PatchPasarelaIntegracionByIdDto,
  VerificarPasarelaIntegracionDto,
} from './dto/pasarela-integracion.dto';
import { PasarelasIntegracionService } from './pasarelas-integracion.service';

@ApiTags('pasarelas')
@ApiBearerAuth('access-token')
@Controller('pasarelas/integraciones')
export class PasarelasIntegracionesController {
  constructor(
    private readonly service: PasarelasIntegracionService,
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar integraciones de pasarelas' })
  async list(@CurrentUser() user: AccessTokenPayload, @Query() query: PasarelaIntegracionQueryDto) {
    const operables = await this.operableIds(user);
    return this.service.list(query.sucursal_id, operables);
  }

  @Post()
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear integración de pasarela' })
  create(@Body() dto: CreatePasarelaIntegracionDto) {
    return this.service.create(dto);
  }

  @Patch()
  @Roles('admin')
  @ApiOperation({ summary: 'Actualizar integración (body.id)' })
  patch(@Body() dto: PatchPasarelaIntegracionDto) {
    return this.service.patch(dto);
  }

  @Delete()
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar integración (query id o body)' })
  delete(@Query() query: DeletePasarelaIntegracionQueryDto, @Body() body?: DeletePasarelaIntegracionQueryDto) {
    const id = query.id?.trim() || body?.id?.trim();
    if (!id) throw new BadRequestException('id es obligatorio');
    return this.service.delete(id);
  }

  private async operableIds(user: AccessTokenPayload): Promise<string[]> {
    const tenantId = this.tenantContext.getTenantId();
    const role = resolveAppRole(user);
    return this.usersService.listOperableSucursalIds(user.sub, tenantId, role);
  }
}

@ApiTags('pasarelas')
@ApiBearerAuth('access-token')
@Controller('pasarelas/integraciones/:id')
export class PasarelasIntegracionIdController {
  constructor(
    private readonly service: PasarelasIntegracionService,
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Obtener integración por id' })
  async getOne(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    const operables = await this.operableIds(user);
    return this.service.getById(id, operables);
  }

  @Patch()
  @Roles('admin')
  @ApiOperation({ summary: 'Actualizar integración por id' })
  patchById(@Param('id') id: string, @Body() dto: PatchPasarelaIntegracionByIdDto) {
    return this.service.patchById(id, dto);
  }

  @Delete()
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar integración por id' })
  deleteById(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Post('verificar')
  @Roles('admin')
  @ApiOperation({ summary: 'Verificar credenciales de integración' })
  verificar(@Param('id') id: string, @Body() dto: VerificarPasarelaIntegracionDto) {
    return this.service.verificar(id, dto);
  }

  private async operableIds(user: AccessTokenPayload): Promise<string[]> {
    const tenantId = this.tenantContext.getTenantId();
    const role = resolveAppRole(user);
    return this.usersService.listOperableSucursalIds(user.sub, tenantId, role);
  }
}
