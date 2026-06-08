import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { CobranzaFactura } from '../cobranza/entities/cobranza-factura.entity';
import { CobranzaPago } from '../cobranza/entities/cobranza-pago.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { FacturaImportadaAplicacion } from '../facturacion/entities/factura-importada-aplicacion.entity';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ClienteComprobantesService } from './cliente-comprobantes.service';
import { ProveedorFacturasImportadasService } from './proveedor-facturas-importadas.service';
import { Categoria } from './entities/categoria.entity';
import { Cliente } from './entities/cliente.entity';
import { Proveedor } from './entities/proveedor.entity';
import { SupplierMergeController } from './supplier-merge.controller';
import { SupplierMergeService } from './supplier-merge.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Categoria,
      Proveedor,
      Cliente,
      ModuloConfig,
      Comprobante,
      FacturaImportadaAplicacion,
      CobranzaFactura,
      CobranzaPago,
      Tenant,
    ]),
    AuthModule,
  ],
  controllers: [CatalogController, SupplierMergeController],
  providers: [
    CatalogService,
    SupplierMergeService,
    ClienteComprobantesService,
    ProveedorFacturasImportadasService,
  ],
  exports: [
    CatalogService,
    SupplierMergeService,
    ClienteComprobantesService,
    ProveedorFacturasImportadasService,
  ],
})
export class CatalogModule {}
