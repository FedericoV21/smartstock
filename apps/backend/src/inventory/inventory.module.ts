import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { UsersModule } from '../users/users.module';
import { Producto } from '../products/entities/producto.entity';
import { BranchTransfersController } from './branch-transfers.controller';
import { BranchTransfersService } from './branch-transfers.service';
import { Movimiento } from './entities/movimiento.entity';
import { StockTransferenciaSucursal } from './entities/stock-transferencia-sucursal.entity';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Producto,
      Movimiento,
      StockTransferenciaSucursal,
      StockSucursal,
      Sucursal,
    ]),
    AuthModule,
    BranchesModule,
    UsersModule,
  ],
  controllers: [InventoryController, BranchTransfersController],
  providers: [InventoryService, BranchTransfersService],
})
export class InventoryModule {}
