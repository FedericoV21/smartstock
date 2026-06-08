import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Caja } from '../caja/entities/caja.entity';
import { LegacyFieldCryptoService } from '../common/crypto/legacy-field-crypto.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { MpQrConfig } from './entities/mp-qr-config.entity';
import { MpQrWebhookLog } from './entities/mp-qr-webhook-log.entity';
import { MpQrClientFactory } from './mp-qr-client.factory';
import { MpQrConfigController } from './mp-qr-config.controller';
import { MpQrConfigService } from './mp-qr-config.service';
import { MpQrEventBroadcastService } from './mp-qr-event-broadcast.service';
import { MpQrPaymentService } from './mp-qr-payment.service';
import { MpQrPaymentsController } from './mp-qr-payments.controller';
import { MpQrWebhookController } from './mp-qr-webhook.controller';
import { MpQrWebhookService } from './mp-qr-webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MpQrConfig,
      MpQrWebhookLog,
      ModuloConfig,
      Sucursal,
      Comprobante,
      ComprobanteItem,
      Caja,
      Usuario,
      Tenant,
    ]),
    AuthModule,
    BranchesModule,
    FacturacionModule,
  ],
  controllers: [MpQrConfigController, MpQrPaymentsController, MpQrWebhookController],
  providers: [
    MpQrConfigService,
    MpQrPaymentService,
    MpQrWebhookService,
    MpQrEventBroadcastService,
    LegacyFieldCryptoService,
    MpQrClientFactory,
  ],
  exports: [MpQrConfigService, MpQrPaymentService, MpQrWebhookService, MpQrEventBroadcastService, MpQrClientFactory],
})
export class MpQrModule {}
