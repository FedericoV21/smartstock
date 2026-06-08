import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ArcaConfig } from '../arca/entities/arca-config.entity';
import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { CajaModule } from '../caja/caja.module';
import { CajaApertura } from '../caja/entities/caja-apertura.entity';
import { CajaTurno } from '../caja/entities/caja-turno.entity';
import { Caja } from '../caja/entities/caja.entity';
import { CierreZ } from '../caja/entities/cierre-z.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { UsersModule } from '../users/users.module';
import { BusinessPrefsService } from './business-prefs.service';
import { ConfigCajasService } from './config-cajas.service';
import { ConfigExtendedController } from './config-extended.controller';
import { ConfigRbacController } from './config-rbac.controller';
import { ConfigRolesService } from './config-roles.service';
import { ConfigUsersRbacService } from './config-users-rbac.service';
import { ConfigUsersService } from './config-users.service';
import { ConfigController } from './config.controller';
import { TenantConfigService } from './config.service';
import { ModuloConfig } from './entities/modulo-config.entity';
import { Tenant } from './entities/tenant.entity';
import { PlanService } from './plan.service';
import { PosPrefsService } from './pos-prefs.service';
import { TenantLogoStorageService } from './storage/tenant-logo.storage';
import { TenantLogoService } from './tenant-logo.service';
import { CajaUsuario } from '../caja/entities/caja-usuario.entity';
import { PedidoWorkflowEstado } from '../pedidos/entities/pedido-workflow-estado.entity';
import { Permiso } from '../rbac/entities/permiso.entity';
import { Rol } from '../rbac/entities/rol.entity';
import { RolPermiso } from '../rbac/entities/rol-permiso.entity';
import { UsuarioCredencialLocal } from '../rbac/entities/usuario-credencial-local.entity';
import { UsuarioCredencialPassword } from '../rbac/entities/usuario-credencial-password.entity';
import { UsuarioInviteToken } from '../auth/entities/usuario-invite-token.entity';
import { UsuarioPedidoWorkflowEstado } from '../rbac/entities/usuario-pedido-workflow-estado.entity';
import { UsuarioPermiso } from '../rbac/entities/usuario-permiso.entity';
import { UsuarioRol } from '../rbac/entities/usuario-rol.entity';
import { UsuarioSucursal } from '../users/entities/usuario-sucursal.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      ModuloConfig,
      ArcaConfig,
      Sucursal,
      Usuario,
      Caja,
      CajaUsuario,
      CajaTurno,
      CajaApertura,
      CierreZ,
      Comprobante,
      UsuarioSucursal,
      Permiso,
      Rol,
      RolPermiso,
      UsuarioRol,
      UsuarioPermiso,
      UsuarioCredencialLocal,
      UsuarioCredencialPassword,
      UsuarioInviteToken,
      UsuarioPedidoWorkflowEstado,
      PedidoWorkflowEstado,
    ]),
    AuthModule,
    BranchesModule,
    UsersModule,
    CajaModule,
  ],
  controllers: [ConfigController, ConfigExtendedController, ConfigRbacController],
  providers: [
    TenantConfigService,
    BusinessPrefsService,
    TenantLogoStorageService,
    TenantLogoService,
    ConfigUsersService,
    ConfigUsersRbacService,
    ConfigRolesService,
    ConfigCajasService,
    PlanService,
    PosPrefsService,
  ],
})
export class TenantConfigModule {}
