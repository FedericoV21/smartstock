import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ArcaModule } from '../arca/arca.module';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { WhatsappAgentTurnLog } from '../whatsapp/entities/whatsapp-agent-turn-log.entity';
import { WhatsappAuthChallenge } from '../whatsapp/entities/whatsapp-auth-challenge.entity';
import { WhatsappJobEvent } from '../whatsapp/entities/whatsapp-job-event.entity';
import { WhatsappProcessingJob } from '../whatsapp/entities/whatsapp-processing-job.entity';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { CronArcaController } from './cron-arca.controller';
import { LectorFacturasModule } from '../lector-facturas/lector-facturas.module';
import { LectorFacturaJob } from '../lector-facturas/entities/lector-factura-job.entity';
import { CronLectorFacturasController } from './cron-lector-facturas.controller';
import { CronLectorFacturasService } from './cron-lector-facturas.service';
import { CronWhatsappController } from './cron-whatsapp.controller';
import { CronWhatsappService } from './cron-whatsapp.service';
import { ReintentarArcaCronService } from './reintentar-arca-cron.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Comprobante,
      WhatsappAuthChallenge,
      WhatsappAgentTurnLog,
      WhatsappProcessingJob,
      WhatsappJobEvent,
      LectorFacturaJob,
    ]),
    FacturacionModule,
    ArcaModule,
    forwardRef(() => LectorFacturasModule),
    WhatsappModule,
  ],
  controllers: [CronArcaController, CronWhatsappController, CronLectorFacturasController],
  providers: [ReintentarArcaCronService, CronWhatsappService, CronLectorFacturasService],
  exports: [CronLectorFacturasService],
})
export class CronModule {}
