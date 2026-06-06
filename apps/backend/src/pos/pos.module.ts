import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { PrecioSucursal } from '../branches/entities/precio-sucursal.entity';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { ProductoVarianteStockSucursal } from '../products/entities/producto-variante-stock-sucursal.entity';
import { ProductoVariante } from '../products/entities/producto-variante.entity';
import { Producto } from '../products/entities/producto.entity';
import { PromocionComboItem } from '../promotions/entities/promocion-combo-item.entity';
import { PromocionSucursal } from '../promotions/entities/promocion-sucursal.entity';
import { Promocion } from '../promotions/entities/promocion.entity';
import { UsersModule } from '../users/users.module';
import { PosBorradorService } from './pos-borrador.service';
import { PosEnrichmentService } from './pos-enrichment.service';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Producto,
      Proveedor,
      Categoria,
      Promocion,
      PromocionSucursal,
      PromocionComboItem,
      ModuloConfig,
      Comprobante,
      ComprobanteItem,
      Cliente,
      Tenant,
      StockSucursal,
      PrecioSucursal,
      ProductoVariante,
      ProductoVarianteStockSucursal,
    ]),
    AuthModule,
    BranchesModule,
    UsersModule,
  ],
  controllers: [PosController],
  providers: [PosService, PosBorradorService, PosEnrichmentService],
  exports: [PosService],
})
export class PosModule {}
