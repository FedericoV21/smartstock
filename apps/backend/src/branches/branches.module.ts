import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { Tenant } from '../config/entities/tenant.entity';
import { BranchPluController } from './branch-plu.controller';
import { BranchPluService } from './branch-plu.service';
import { BranchPricingController } from './branch-pricing.controller';
import { BranchPricingService } from './branch-pricing.service';
import { BranchStockController } from './branch-stock.controller';
import { BranchStockService } from './branch-stock.service';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { PluSucursal } from './entities/plu-sucursal.entity';
import { PrecioSucursal } from './entities/precio-sucursal.entity';
import { StockSucursal } from './entities/stock-sucursal.entity';
import { Sucursal } from './entities/sucursal.entity';
import { SucursalContext } from './sucursal-context.service';
import { Producto } from '../products/entities/producto.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Sucursal,
      StockSucursal,
      PrecioSucursal,
      PluSucursal,
      Tenant,
      Producto,
    ]),
    AuthModule,
    UsersModule,
  ],
  controllers: [
    BranchesController,
    BranchStockController,
    BranchPricingController,
    BranchPluController,
  ],
  providers: [
    BranchesService,
    BranchStockService,
    BranchPricingService,
    BranchPluService,
    SucursalContext,
  ],
  exports: [
    BranchesService,
    BranchStockService,
    BranchPricingService,
    BranchPluService,
    SucursalContext,
  ],
})
export class BranchesModule {}
