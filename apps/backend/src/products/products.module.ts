import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Tenant } from '../config/entities/tenant.entity';
import { BranchesModule } from '../branches/branches.module';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { UsersModule } from '../users/users.module';
import { ProductoBarcode } from './entities/producto-barcode.entity';
import { ProductoVarianteStockSucursal } from './entities/producto-variante-stock-sucursal.entity';
import { ProductoLoteIngreso } from './entities/producto-lote-ingreso.entity';
import { ProductoVariante } from './entities/producto-variante.entity';
import { Producto } from './entities/producto.entity';
import { ProductImageController } from './product-image.controller';
import { ProductImageService } from './product-image.service';
import { ProductMergeController } from './product-merge.controller';
import { ProductMergeService } from './product-merge.service';
import { ProductLotesController } from './product-lotes.controller';
import { ProductLotesService } from './product-lotes.service';
import { ProductImageS3StorageService } from './storage/product-image-s3.storage';
import { ProductVariantsController } from './product-variants.controller';
import { ProductVariantsService } from './product-variants.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { QendraExportController } from './qendra-export.controller';
import { QendraExportService } from './qendra-export.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Producto,
      ProductoLoteIngreso,
      ProductoBarcode,
      ProductoVariante,
      ProductoVarianteStockSucursal,
      StockSucursal,
      Sucursal,
      Categoria,
      Proveedor,
      Tenant,
    ]),
    AuthModule,
    BranchesModule,
    UsersModule,
  ],
  controllers: [
    ProductsController,
    ProductImageController,
    ProductMergeController,
    ProductLotesController,
    ProductVariantsController,
    QendraExportController,
  ],
  providers: [
    ProductsService,
    ProductImageService,
    ProductImageS3StorageService,
    ProductMergeService,
    ProductLotesService,
    ProductVariantsService,
    QendraExportService,
  ],
  exports: [ProductLotesService],
})
export class ProductsModule {}
