import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Caja } from '../caja/entities/caja.entity';
import { LegacyFieldCryptoService } from '../common/crypto/legacy-field-crypto.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { MpPointModule } from '../mp-point/mp-point.module';
import { MpPointConfig } from '../mp-point/entities/mp-point-config.entity';
import { MpQrModule } from '../mp-qr/mp-qr.module';
import { MpQrConfig } from '../mp-qr/entities/mp-qr-config.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { UsersModule } from '../users/users.module';
import { PasarelaCaja } from './entities/pasarela-caja.entity';
import { PasarelaIntegracion } from './entities/pasarela-integracion.entity';
import { PasarelaTransaccion } from './entities/pasarela-transaccion.entity';
import { PasarelaWebhookLog } from './entities/pasarela-webhook-log.entity';
import { PasarelaAdaptersService } from './pasarela-adapters.service';
import { PasarelaPaymentAdaptersService } from './pasarela-payment-adapters.service';
import {
  CajaPasarelasController,
  PasarelasMpQrController,
} from './pasarelas.controller';
import { PasarelasCobrosController } from './pasarelas-cobros.controller';
import { PasarelasCobrosService } from './pasarelas-cobros.service';
import {
  PasarelasIntegracionIdController,
  PasarelasIntegracionesController,
} from './pasarelas-integracion.controller';
import { PasarelasCajaService } from './pasarelas-caja.service';
import { PasarelasIntegracionService } from './pasarelas-integracion.service';
import { PasarelasMpQrService } from './pasarelas-mp-qr.service';
import { PasarelasTransaccionesService } from './pasarelas-transacciones.service';
import { PasarelasWebhookController } from './pasarelas-webhook.controller';
import { PasarelasWebhookService } from './pasarelas-webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PasarelaIntegracion,
      PasarelaCaja,
      PasarelaTransaccion,
      PasarelaWebhookLog,
      Caja,
      Sucursal,
      ModuloConfig,
      MpPointConfig,
      MpQrConfig,
      Comprobante,
      Tenant,
    ]),
    AuthModule,
    BranchesModule,
    UsersModule,
    MpPointModule,
    MpQrModule,
  ],
  controllers: [
    PasarelasIntegracionesController,
    PasarelasIntegracionIdController,
    CajaPasarelasController,
    PasarelasMpQrController,
    PasarelasCobrosController,
    PasarelasWebhookController,
  ],
  providers: [
    PasarelasIntegracionService,
    PasarelasCajaService,
    PasarelasMpQrService,
    PasarelaAdaptersService,
    PasarelaPaymentAdaptersService,
    PasarelasTransaccionesService,
    PasarelasCobrosService,
    PasarelasWebhookService,
    LegacyFieldCryptoService,
  ],
  exports: [
    PasarelasIntegracionService,
    PasarelaAdaptersService,
    PasarelaPaymentAdaptersService,
    PasarelasCobrosService,
  ],
})
export class PasarelasModule {}
