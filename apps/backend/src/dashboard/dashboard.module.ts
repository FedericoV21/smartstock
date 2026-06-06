import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Producto } from '../products/entities/producto.entity';
import { UsersModule } from '../users/users.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Producto, StockSucursal, Comprobante]),
    AuthModule,
    UsersModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
