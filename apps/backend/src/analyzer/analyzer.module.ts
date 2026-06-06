import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { CobranzaPago } from '../cobranza/entities/cobranza-pago.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Pago } from '../cuenta-corriente/entities/pago.entity';
import { ImportacionLog } from '../importaciones/entities/importacion-log.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Movimiento } from '../inventory/entities/movimiento.entity';
import { ProductoProveedor } from '../products/entities/producto-proveedor.entity';
import { Producto } from '../products/entities/producto.entity';
import { AnalyzerCuentaCorrienteService } from './analyzer-cuenta-corriente.service';
import { AnalyzerController } from './analyzer.controller';
import { AnalyzerService } from './analyzer.service';
import { CierreMensual } from './entities/cierre-mensual.entity';
import { RadarInflacion } from './entities/radar-inflacion.entity';
import { ListaPreciosItem } from './price-lists/entities/lista-precios-item.entity';
import { ListaPrecios } from './price-lists/entities/lista-precios.entity';
import { PriceListsController } from './price-lists/price-lists.controller';
import { PriceListPreviewService } from './price-lists/price-list-preview.service';
import { PriceListReportService } from './price-lists/price-list-report.service';
import { PriceListsService } from './price-lists/price-lists.service';
import { PriceListFileStorage } from './price-lists/storage/price-list-file.storage';
import { AnalyzerSuppliersService } from './suppliers/analyzer-suppliers.service';
import { PrecioHistorial } from '../pricing/entities/precio-historial.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Comprobante,
      ComprobanteItem,
      Producto,
      ProductoProveedor,
      Categoria,
      Cliente,
      Proveedor,
      CierreMensual,
      RadarInflacion,
      Movimiento,
      ModuloConfig,
      ImportacionLog,
      ListaPrecios,
      ListaPreciosItem,
      PrecioHistorial,
      Sucursal,
      CuentaCorriente,
      Pago,
      CobranzaPago,
    ]),
    AuthModule,
    AiModule,
  ],
  controllers: [AnalyzerController, PriceListsController],
  providers: [
    AnalyzerService,
    AnalyzerSuppliersService,
    AnalyzerCuentaCorrienteService,
    PriceListsService,
    PriceListPreviewService,
    PriceListReportService,
    PriceListFileStorage,
  ],
  exports: [PriceListsService],
})
export class AnalyzerModule {}
