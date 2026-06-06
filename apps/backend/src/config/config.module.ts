import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ArcaConfig } from '../arca/entities/arca-config.entity';
import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Caja } from '../caja/entities/caja.entity';
import { CajaUsuario } from '../caja/entities/caja-usuario.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { UsersModule } from '../users/users.module';
import { BusinessPrefsService } from './business-prefs.service';
import { ConfigUsersService } from './config-users.service';
import { ConfigController } from './config.controller';
import { TenantConfigService } from './config.service';
import { ModuloConfig } from './entities/modulo-config.entity';
import { Tenant } from './entities/tenant.entity';
import { TenantLogoStorageService } from './storage/tenant-logo.storage';
import { TenantLogoService } from './tenant-logo.service';

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
    ]),
    AuthModule,
    BranchesModule,
    UsersModule,
  ],
  controllers: [ConfigController],
  providers: [
    TenantConfigService,
    BusinessPrefsService,
    TenantLogoStorageService,
    TenantLogoService,
    ConfigUsersService,
  ],
})
export class TenantConfigModule {}
