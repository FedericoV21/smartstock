import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Sucursal } from '../branches/entities/sucursal.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { NexusDashboardAuthService } from './nexus-dashboard-auth.service';
import { NexusDashboardController } from './nexus-dashboard.controller';
import { NexusDashboardTenantsService } from './nexus-dashboard-tenants.service';

@Module({
  imports: [TypeOrmModule.forFeature([Usuario, Tenant, Sucursal])],
  controllers: [NexusDashboardController],
  providers: [NexusDashboardAuthService, NexusDashboardTenantsService],
})
export class NexusDashboardModule {}
