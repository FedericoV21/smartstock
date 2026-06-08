import { Module } from '@nestjs/common';

import { TypeOrmModule } from '@nestjs/typeorm';



import { AuthModule } from '../auth/auth.module';

import { BranchesModule } from '../branches/branches.module';
import { UsersModule } from '../users/users.module';

import { Proveedor } from '../catalog/entities/proveedor.entity';

import { PrecioSucursal } from '../branches/entities/precio-sucursal.entity';

import { Sucursal } from '../branches/entities/sucursal.entity';

import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';

import { ProductoBarcode } from '../products/entities/producto-barcode.entity';

import { Producto } from '../products/entities/producto.entity';

import { Usuario } from '../users/entities/usuario.entity';

import { ImportConvertPdfController } from './import-convert-pdf.controller';
import { ImportConvertPdfService } from './import-convert-pdf.service';
import { ImportDraftController } from './import-draft.controller';

import { ImportDraftService } from './import-draft.service';

import { ImportLinkableProductsController } from './import-linkable-products.controller';

import { ImportLinkableProductsService } from './import-linkable-products.service';

import { ImportLogController } from './import-log.controller';

import { ImportLogService } from './import-log.service';

import { ImportSupplierObligationController } from './import-supplier-obligation.controller';

import { ImportSupplierObligationService } from './import-supplier-obligation.service';

import { CuentaCorriente } from './entities/cuenta-corriente.entity';

import { ImportacionArchivo } from './entities/importacion-archivo.entity';

import { ImportacionBorradorArchivo } from './entities/importacion-borrador-archivo.entity';

import { ImportacionBorradorChunk } from './entities/importacion-borrador-chunk.entity';

import { ImportacionBorrador } from './entities/importacion-borrador.entity';

import { ImportacionLog } from './entities/importacion-log.entity';

import { ImportacionProductoSnapshot } from './entities/importacion-producto-snapshot.entity';

import { PagoProveedorFactura } from './entities/pago-proveedor-factura.entity';

import { ImportPreflightService } from './import-preflight.service';
import { ImportacionesController } from './importaciones.controller';

import { ImportacionesService } from './importaciones.service';



@Module({

  imports: [

    TypeOrmModule.forFeature([

      Producto,

      ProductoBarcode,

      PrecioSucursal,

      ImportacionBorrador,

      ImportacionBorradorChunk,

      ImportacionBorradorArchivo,

      ImportacionArchivo,

      ImportacionLog,

      ImportacionProductoSnapshot,

      PagoProveedorFactura,

      CuentaCorriente,

      Proveedor,

      Sucursal,

      Tenant,

      ModuloConfig,

      Usuario,

    ]),

    AuthModule,

    BranchesModule,

    UsersModule,

  ],

  controllers: [

    ImportacionesController,

    ImportDraftController,

    ImportLogController,

    ImportSupplierObligationController,

    ImportLinkableProductsController,

    ImportConvertPdfController,

  ],

  providers: [

    ImportacionesService,

    ImportDraftService,

    ImportLogService,

    ImportSupplierObligationService,

    ImportLinkableProductsService,

    ImportPreflightService,

    ImportConvertPdfService,

  ],

  exports: [

    ImportDraftService,

    ImportLogService,

    ImportSupplierObligationService,

    ImportLinkableProductsService,

  ],

})

export class ImportacionesModule {}
