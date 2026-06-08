import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { LegacyFieldCryptoService } from '../common/crypto/legacy-field-crypto.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Caja } from '../caja/entities/caja.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { MpPointConfig } from './entities/mp-point-config.entity';
import { MpPointConfigController } from './mp-point-config.controller';
import { MpPointConfigService } from './mp-point-config.service';
import { MpPointClientFactory } from './mp-point-client.factory';
import { MpPointEventBroadcastService } from './mp-point-event-broadcast.service';
import { MpPointPaymentsController } from './mp-point-payments.controller';
import { MpPointPaymentService } from './mp-point-payment.service';
import { MpPointWebhookController } from './mp-point-webhook.controller';
import { MpPointWebhookService } from './mp-point-webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MpPointConfig,
      ModuloConfig,
      Sucursal,
      Comprobante,
      ComprobanteItem,
      Caja,
      Usuario,
    ]),
    AuthModule,
    BranchesModule,
    FacturacionModule,
  ],
  controllers: [MpPointConfigController, MpPointPaymentsController, MpPointWebhookController],
  providers: [
    MpPointConfigService,
    MpPointPaymentService,
    MpPointWebhookService,
    MpPointEventBroadcastService,
    LegacyFieldCryptoService,
    MpPointClientFactory,
  ],
  exports: [
    MpPointConfigService,
    MpPointPaymentService,
    MpPointWebhookService,
    MpPointEventBroadcastService,
    LegacyFieldCryptoService,
    MpPointClientFactory,
  ],
})
export class MpPointModule {}
