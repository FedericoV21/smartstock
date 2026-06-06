import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { CajaModule } from '../caja/caja.module';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { PagoProveedorFactura } from '../importaciones/entities/pago-proveedor-factura.entity';
import { CajaTesoreriaCheque } from './entities/caja-tesoreria-cheque.entity';
import { CajaTesoreriaMovimiento } from './entities/caja-tesoreria-movimiento.entity';
import { CajaTesoreria } from './entities/caja-tesoreria.entity';
import { TesoreriaContextService } from './tesoreria-context.service';
import { TesoreriaController } from './tesoreria.controller';
import { TesoreriaService } from './tesoreria.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CajaTesoreria,
      CajaTesoreriaMovimiento,
      CajaTesoreriaCheque,
      Tenant,
      Sucursal,
      ModuloConfig,
      PagoProveedorFactura,
      Proveedor,
      Comprobante,
    ]),
    AuthModule,
    CajaModule,
  ],
  controllers: [TesoreriaController],
  providers: [TesoreriaContextService, TesoreriaService],
})
export class TesoreriaModule {}
