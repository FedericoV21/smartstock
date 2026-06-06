import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { BusinessPrefsService } from './business-prefs.service';
import { ConfigUsersService } from './config-users.service';
import { TenantConfigService } from './config.service';
import { BusinessPrefsQueryDto, PatchBusinessPrefsDto } from './dto/business-prefs.dto';
import { InviteUserDto, PatchConfigUserDto } from './dto/config-users.dto';
import { PatchTenantDto } from './dto/patch-tenant.dto';
import { TENANT_LOGO_MAX_BYTES } from './storage/tenant-logo.storage';
import { TenantLogoService } from './tenant-logo.service';

@ApiTags('config')
@ApiBearerAuth('access-token')
@Controller('config')
export class ConfigController {
  constructor(
    private readonly configService: TenantConfigService,
    private readonly businessPrefsService: BusinessPrefsService,
    private readonly tenantLogoService: TenantLogoService,
    private readonly configUsersService: ConfigUsersService,
  ) {}

  @Get('tenant')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Perfil del negocio (tenant) del JWT' })
  getTenant() {
    return this.configService.getTenantProfile();
  }

  @Patch('tenant')
  @Roles('admin')
  @ApiOperation({
    summary: 'Actualizar datos del negocio',
    description: 'Paridad PATCH /api/configuracion/tenant. Solo admin.',
  })
  patchTenant(@Body() dto: PatchTenantDto) {
    return this.configService.patchTenant(dto);
  }

  @Get('modules')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Feature flags modulo_config del tenant' })
  getModules() {
    return this.configService.getModuloConfig();
  }

  @Get('business-prefs')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Preferencias de negocio efectivas o pantalla de config' })
  getBusinessPrefs(@Query() query: BusinessPrefsQueryDto) {
    return this.businessPrefsService.getBusinessPrefs(
      query.for_config === '1',
      query.sucursal_id ?? null,
    );
  }

  @Patch('business-prefs')
  @Roles('admin')
  @ApiOperation({ summary: 'Actualizar business_prefs de tenant o sucursal' })
  patchBusinessPrefs(@Body() dto: PatchBusinessPrefsDto, @CurrentUser() user: AccessTokenPayload) {
    return this.businessPrefsService.patchBusinessPrefs(dto, resolveAppRole(user));
  }

  @Post('logo')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Subir logo del negocio (PNG/JPG/WebP, m├íx. 2 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: TENANT_LOGO_MAX_BYTES },
    }),
  )
  uploadLogo(@UploadedFile() file: Express.Multer.File) {
    return this.tenantLogoService.uploadLogo(file);
  }

  @Delete('logo')
  @Roles('admin')
  @ApiOperation({ summary: 'Quitar logo del negocio' })
  deleteLogo() {
    return this.tenantLogoService.deleteLogo();
  }

  @Get('users')
  @Roles('admin')
  @ApiOperation({ summary: 'Listar usuarios del negocio' })
  listUsers() {
    return this.configUsersService.listUsers();
  }

  @Post('users')
  @Roles('admin')
  @ApiOperation({ summary: 'Invitar usuario por correo (requiere Supabase Auth admin)' })
  inviteUser(@Body() dto: InviteUserDto) {
    return this.configUsersService.inviteUser(dto);
  }

  @Patch('users/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Editar usuario del negocio' })
  patchUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchConfigUserDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.configUsersService.patchUser(id, user.sub, dto);
  }

  @Delete('users/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar usuario (soft delete)' })
  deleteUser(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.configUsersService.deleteUser(id, user.sub);
  }
}
