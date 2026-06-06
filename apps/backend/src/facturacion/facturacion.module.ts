import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ArcaModule } from '../arca/arca.module';
import { ArcaConfig } from '../arca/entities/arca-config.entity';
import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { Movimiento } from '../inventory/entities/movimiento.entity';
import { ProductoLoteIngreso } from '../products/entities/producto-lote-ingreso.entity';
import { ProductoVarianteStockSucursal } from '../products/entities/producto-variante-stock-sucursal.entity';
import { Producto } from '../products/entities/producto.entity';
import { MedioPagoOpcion } from '../payment-methods/entities/medio-pago-opcion.entity';
import { MedioPagoRapido } from '../payment-methods/entities/medio-pago-rapido.entity';
import { ArcaTrayService } from './arca-tray.service';
import { CompraProveedorManualService } from './compra-proveedor-manual.service';
import { ComprobanteRetryArcaService } from './comprobante-retry-arca.service';
import { ComprobanteVoidService } from './comprobante-void.service';
import { ComprobanteItem } from './entities/comprobante-item.entity';
import { Comprobante } from './entities/comprobante.entity';
import { FacturaImportadaAplicacion } from './entities/factura-importada-aplicacion.entity';
import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';
import { FinanciacionEmitService } from './financiacion-emit.service';
import { ComprobantePdfRegenerationService } from './pdf/comprobante-pdf-regeneration.service';
import { ComprobantePdfService } from './pdf/comprobante-pdf.service';
import { PdfS3StorageService } from './storage/pdf-s3.storage';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Comprobante,
      ComprobanteItem,
      Producto,
      ProductoLoteIngreso,
      Cliente,
      Proveedor,
      ArcaConfig,
      Tenant,
      Movimiento,
      StockSucursal,
      ProductoVarianteStockSucursal,
      FacturaImportadaAplicacion,
      Sucursal,
      ModuloConfig,
      MedioPagoOpcion,
      MedioPagoRapido,
    ]),
    AuthModule,
    BranchesModule,
    forwardRef(() => ArcaModule),
  ],
  controllers: [FacturacionController],
  providers: [
    FacturacionService,
    FinanciacionEmitService,
    CompraProveedorManualService,
    ArcaTrayService,
    ComprobanteRetryArcaService,
    ComprobanteVoidService,
    ComprobantePdfService,
    PdfS3StorageService,
    ComprobantePdfRegenerationService,
  ],
  exports: [
    TypeOrmModule.forFeature([Comprobante, ComprobanteItem, Producto, Cliente, ArcaConfig, Tenant]),
    ComprobantePdfService,
    ComprobantePdfRegenerationService,
    FacturacionService,
  ],
})
export class FacturacionModule {}
