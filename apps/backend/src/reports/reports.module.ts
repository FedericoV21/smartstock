import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { CobranzaFactura } from '../cobranza/entities/cobranza-factura.entity';
import { CobranzaPago } from '../cobranza/entities/cobranza-pago.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { CuentaCorrienteModule } from '../cuenta-corriente/cuenta-corriente.module';
import { Pago } from '../cuenta-corriente/entities/pago.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { Movimiento } from '../inventory/entities/movimiento.entity';
import { Producto } from '../products/entities/producto.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { ReportsAdvancedService } from './reports-advanced.service';
import { ReportsController } from './reports.controller';
import { ReportsExtendedService } from './reports-extended.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Comprobante,
      ComprobanteItem,
      CuentaCorriente,
      Cliente,
      CobranzaPago,
      CobranzaFactura,
      Pago,
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
    CuentaCorrienteModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsAdvancedService, ReportsExtendedService],
  exports: [ReportsService, ReportsAdvancedService],
})
export class ReportsModule {}
