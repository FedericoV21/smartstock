import { forwardRef, Module } from '@nestjs/common';

import { TypeOrmModule } from '@nestjs/typeorm';



import { AuthModule } from '../auth/auth.module';

import { BranchesModule } from '../branches/branches.module';

import { Sucursal } from '../branches/entities/sucursal.entity';

import { Cliente } from '../catalog/entities/cliente.entity';

import { Proveedor } from '../catalog/entities/proveedor.entity';

import { ModuloConfig } from '../config/entities/modulo-config.entity';

import { Tenant } from '../config/entities/tenant.entity';

import { Comprobante } from '../facturacion/entities/comprobante.entity';

import { FacturacionModule } from '../facturacion/facturacion.module';

import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';

import { ImportacionLog } from '../importaciones/entities/importacion-log.entity';

import { PagoProveedorFactura } from '../importaciones/entities/pago-proveedor-factura.entity';

import { Producto } from '../products/entities/producto.entity';

import { Usuario } from '../users/entities/usuario.entity';

import { CronModule } from '../cron/cron.module';

import { ApiExtractorAuthService } from './api-extractor-auth.service';

import { ApiIntegracionAuthService } from './api-integracion-auth.service';

import { ApiExtractorKey } from './entities/api-extractor-key.entity';

import { ApiIntegracionKey } from './entities/api-integracion-key.entity';

import { FacturaExtractorLog } from './entities/factura-extractor-log.entity';

import { LectorFacturaJob } from './entities/lector-factura-job.entity';

import { LectorFacturaLog } from './entities/lector-factura-log.entity';

import { LectorConfirmacionChatbotService } from './lector-confirmacion-chatbot.service';

import { LectorConfirmacionImportadoService } from './lector-confirmacion-importado.service';

import { LectorStorageService } from './lector-storage.service';

import { LectorFacturasBaseService } from './lector-facturas-base.service';

import { LectorFacturasBorradoresService } from './lector-facturas-borradores.service';

import { LectorFacturasConfirmService } from './lector-facturas-confirm.service';

import { LectorFacturasController } from './lector-facturas.controller';

import { LectorFacturasExtractService } from './lector-facturas-extract.service';

import { LectorFacturasJobsService } from './lector-facturas-jobs.service';

import { LectorFacturasLimiteService } from './lector-facturas-limite.service';

import { LectorFacturasLogsService } from './lector-facturas-logs.service';

import { InvoiceExtractorPublicController } from './invoice-extractor-public.controller';

import { InvoiceExtractorService } from './invoice-extractor.service';

import { LectorFacturasPublicController } from './lector-facturas-public.controller';

import { LectorFacturasTablaOcrService } from './lector-facturas-tabla-ocr.service';



@Module({

  imports: [

    TypeOrmModule.forFeature([

      ModuloConfig,

      Tenant,

      Sucursal,

      ImportacionLog,

      Proveedor,

      Cliente,

      Producto,

      Usuario,

      Comprobante,

      CuentaCorriente,

      PagoProveedorFactura,

      LectorFacturaLog,

      LectorFacturaJob,

      ApiIntegracionKey,

      ApiExtractorKey,

      FacturaExtractorLog,

    ]),

    AuthModule,

    BranchesModule,

    FacturacionModule,

    forwardRef(() => CronModule),

  ],

  controllers: [
    LectorFacturasController,
    LectorFacturasPublicController,
    InvoiceExtractorPublicController,
  ],

  providers: [

    LectorFacturasBaseService,

    LectorFacturasLimiteService,

    LectorFacturasLogsService,

    LectorFacturasBorradoresService,

    LectorFacturasExtractService,

    LectorFacturasConfirmService,

    LectorConfirmacionImportadoService,

    LectorConfirmacionChatbotService,

    LectorFacturasTablaOcrService,

    ApiIntegracionAuthService,

    ApiExtractorAuthService,

    InvoiceExtractorService,

    LectorFacturasJobsService,

    LectorStorageService,

  ],

  exports: [

    LectorFacturasBaseService,

    LectorFacturasExtractService,

    LectorStorageService,

    LectorConfirmacionImportadoService,

    LectorConfirmacionChatbotService,

  ],

})

export class LectorFacturasModule {}

