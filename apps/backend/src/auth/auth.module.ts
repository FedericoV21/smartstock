import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { getJwtSigningSecret } from '../config/jwt-secret.util';
import { Tenant } from '../config/entities/tenant.entity';
import { UsuarioCredencialLocal } from '../rbac/entities/usuario-credencial-local.entity';
import { UsuarioCredencialPassword } from '../rbac/entities/usuario-credencial-password.entity';
import { Permiso } from '../rbac/entities/permiso.entity';
import { Rol } from '../rbac/entities/rol.entity';
import { RolPermiso } from '../rbac/entities/rol-permiso.entity';
import { UsuarioRol } from '../rbac/entities/usuario-rol.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AuthRegisterService } from './auth-register.service';
import { AuthController } from './auth.controller';
import { AuthTokenService } from './auth-token.service';
import { AuthRefreshToken } from './entities/auth-refresh-token.entity';
import { UsuarioInviteToken } from './entities/usuario-invite-token.entity';
import { SuperAdminContextoLog } from './entities/super-admin-contexto-log.entity';
import { SuperAdminTenantAcceso } from './entities/super-admin-tenant-acceso.entity';
import { EmailAuthService } from './email-auth.service';
import { InviteAuthService } from './invite-auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { LocalAuthService } from './local-auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthSessionService } from './auth-session.service';
import { RolesGuard } from './roles.guard';
import { SuperAdminTenantService } from './super-admin-tenant.service';
import { TenantContext } from './tenant-context.service';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([
      Usuario,
      UsuarioCredencialLocal,
      UsuarioCredencialPassword,
      UsuarioInviteToken,
      AuthRefreshToken,
      Permiso,
      Rol,
      RolPermiso,
      UsuarioRol,
      ModuloConfig,
      SuperAdminTenantAcceso,
      SuperAdminContextoLog,
      Tenant,
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: getJwtSigningSecret(config),
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  controllers: [AuthController, AdminController],
  providers: [
    JwtStrategy,
    AuthTokenService,
    AuthSessionService,
    RefreshTokenService,
    LocalAuthService,
    EmailAuthService,
    InviteAuthService,
    AuthRegisterService,
    SuperAdminTenantService,
    JwtAuthGuard,
    RolesGuard,
    TenantContext,
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
  exports: [
    JwtModule,
    PassportModule,
    JwtAuthGuard,
    RolesGuard,
    TenantContext,
    SuperAdminTenantService,
  ],
})
export class AuthModule {}
