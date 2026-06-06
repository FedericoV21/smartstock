import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { Movimiento } from '../inventory/entities/movimiento.entity';
import { Producto } from '../products/entities/producto.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { ReportsAdvancedService } from './reports-advanced.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Comprobante,
      ComprobanteItem,
      CuentaCorriente,
      Cliente,
      Movimiento,
      Producto,
      Proveedor,
      Categoria,
      StockSucursal,
      Usuario,
      ModuloConfig,
    ]),
    AuthModule,
    BranchesModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsAdvancedService],
})
export class ReportsModule {}
