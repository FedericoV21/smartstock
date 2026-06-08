import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { PagoProveedorFactura } from '../importaciones/entities/pago-proveedor-factura.entity';
import { Producto } from '../products/entities/producto.entity';
import { ClienteCuentaCorrienteController } from './cliente-cuenta-corriente.controller';
import { ClienteCuentaCorrienteService } from './cliente-cuenta-corriente.service';
import { CuentaCorrienteCargosController } from './cuenta-corriente-cargos.controller';
import { PagoProveedorFacturaController } from './pago-proveedor-factura.controller';
import { PagoProveedorFacturaService } from './pago-proveedor-factura.service';
import { PagoProveedorMovimiento } from './entities/pago-proveedor-movimiento.entity';
import { Pago } from './entities/pago.entity';
import { ProveedorCuentaCorrienteController } from './proveedor-cuenta-corriente.controller';
import { ProveedorCuentaCorrienteService } from './proveedor-cuenta-corriente.service';
import { ProveedorPagosController } from './proveedor-pagos.controller';
import { ProveedorPagoRevertirService } from './proveedor-pago-revertir.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Cliente,
      Proveedor,
      CuentaCorriente,
      Pago,
      PagoProveedorFactura,
      PagoProveedorMovimiento,
      Comprobante,
      ComprobanteItem,
      Producto,
      Sucursal,
      Tenant,
      ModuloConfig,
    ]),
    AuthModule,
    BranchesModule,
  ],
  controllers: [
    ClienteCuentaCorrienteController,
    ProveedorCuentaCorrienteController,
    CuentaCorrienteCargosController,
    ProveedorPagosController,
    PagoProveedorFacturaController,
  ],
  providers: [
    ClienteCuentaCorrienteService,
    ProveedorCuentaCorrienteService,
    ProveedorPagoRevertirService,
    PagoProveedorFacturaService,
  ],
  exports: [ClienteCuentaCorrienteService, ProveedorCuentaCorrienteService],
})
export class CuentaCorrienteModule {}
