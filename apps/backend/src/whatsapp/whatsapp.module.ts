import { forwardRef, Module } from '@nestjs/common';

import { TypeOrmModule } from '@nestjs/typeorm';



import { AuthModule } from '../auth/auth.module';

import { BranchesModule } from '../branches/branches.module';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { Producto } from '../products/entities/producto.entity';
import { ReportsModule } from '../reports/reports.module';

import { ModuloConfig } from '../config/entities/modulo-config.entity';

import { Tenant } from '../config/entities/tenant.entity';

import { InternalCronService } from '../cron/internal-cron.service';

import { LectorFacturaJob } from '../lector-facturas/entities/lector-factura-job.entity';

import { LectorFacturasModule } from '../lector-facturas/lector-facturas.module';

import { Usuario } from '../users/entities/usuario.entity';

import { WhatsappActionLog } from './entities/whatsapp-action-log.entity';

import { WhatsappActor } from './entities/whatsapp-actor.entity';

import { WhatsappAgentFeatureFlag } from './entities/whatsapp-agent-feature-flag.entity';

import { WhatsappAgentTurnLog } from './entities/whatsapp-agent-turn-log.entity';

import { WhatsappAuthChallenge } from './entities/whatsapp-auth-challenge.entity';

import { WhatsappBranchRule } from './entities/whatsapp-branch-rule.entity';

import { WhatsappChannel } from './entities/whatsapp-channel.entity';

import { WhatsappInboundAttachment } from './entities/whatsapp-inbound-attachment.entity';

import { WhatsappInboundMessage } from './entities/whatsapp-inbound-message.entity';

import { WhatsappJobEvent } from './entities/whatsapp-job-event.entity';

import { WhatsappOutboundMessage } from './entities/whatsapp-outbound-message.entity';

import { WhatsappPlatformChannel } from './entities/whatsapp-platform-channel.entity';

import { WhatsappPlatformRoutingState } from './entities/whatsapp-platform-routing-state.entity';

import { WhatsappProcessingJob } from './entities/whatsapp-processing-job.entity';

import { WhatsappSandboxInvoiceTicket } from './entities/whatsapp-sandbox-invoice-ticket.entity';
import { WhatsappSandboxMessage } from './entities/whatsapp-sandbox-message.entity';
import { WhatsappSandboxPendingAction } from './entities/whatsapp-sandbox-pending-action.entity';

import { WhatsappActorsService } from './whatsapp-actors.service';

import { WhatsappBaseService } from './whatsapp-base.service';

import { WhatsappBranchRulesService } from './whatsapp-branch-rules.service';

import { WhatsappBranchService } from './whatsapp-branch.service';

import { WhatsappController } from './whatsapp.controller';

import { WhatsappFeatureFlagService } from './whatsapp-feature-flag.service';

import { WhatsappInboundRoutingService } from './whatsapp-inbound-routing.service';

import { WhatsappJobsService } from './whatsapp-jobs.service';

import { WhatsappLectorJobService } from './whatsapp-lector-job.service';

import { WhatsappLogsService } from './whatsapp-logs.service';

import { WhatsappMetaService } from './whatsapp-meta.service';

import { WhatsappOutboundService } from './whatsapp-outbound.service';

import { WhatsappPlatformChannelService } from './whatsapp-platform-channel.service';

import { WhatsappProcessQueuedService } from './whatsapp-process-queued.service';

import { WhatsappStorageService } from './whatsapp-storage.service';

import { WhatsappTextHandlerService } from './whatsapp-text-handler.service';

import { WhatsappReadOnlyAgentService } from './whatsapp-read-only-agent.service';
import { WhatsappReportDownloadController } from './whatsapp-report-download.controller';
import { WhatsappSandboxController } from './whatsapp-sandbox.controller';
import { WhatsappSandboxInvoiceService } from './whatsapp-sandbox-invoice.service';
import { WhatsappSandboxService } from './whatsapp-sandbox.service';

import { WhatsappWebhookController } from './whatsapp-webhook.controller';

import { WhatsappWebhookIngestService } from './whatsapp-webhook-ingest.service';

import { WhatsappWebhookService } from './whatsapp-webhook.service';



@Module({

  imports: [

    TypeOrmModule.forFeature([

      ModuloConfig,

      Sucursal,

      Tenant,

      Usuario,

      LectorFacturaJob,

      WhatsappChannel,

      WhatsappPlatformChannel,

      WhatsappPlatformRoutingState,

      WhatsappInboundMessage,

      WhatsappInboundAttachment,

      WhatsappProcessingJob,

      WhatsappJobEvent,

      WhatsappBranchRule,

      WhatsappOutboundMessage,

      WhatsappActor,

      WhatsappAuthChallenge,

      WhatsappActionLog,

      WhatsappAgentFeatureFlag,

      WhatsappAgentTurnLog,

      WhatsappSandboxMessage,

      WhatsappSandboxPendingAction,

      WhatsappSandboxInvoiceTicket,

      Cliente,

      Proveedor,

      CuentaCorriente,

      Producto,

      StockSucursal,

    ]),

    AuthModule,

    BranchesModule,

    ReportsModule,

    forwardRef(() => LectorFacturasModule),

  ],

  controllers: [
    WhatsappController,
    WhatsappWebhookController,
    WhatsappSandboxController,
    WhatsappReportDownloadController,
  ],

  providers: [

    WhatsappBaseService,

    WhatsappPlatformChannelService,

    WhatsappFeatureFlagService,

    WhatsappBranchRulesService,

    WhatsappJobsService,

    WhatsappLogsService,

    WhatsappWebhookService,

    WhatsappMetaService,

    WhatsappStorageService,

    WhatsappOutboundService,

    WhatsappInboundRoutingService,

    WhatsappBranchService,

    WhatsappWebhookIngestService,

    WhatsappProcessQueuedService,

    WhatsappActorsService,

    WhatsappLectorJobService,

    WhatsappTextHandlerService,

    WhatsappReadOnlyAgentService,

    WhatsappSandboxService,

    WhatsappSandboxInvoiceService,

    InternalCronService,

  ],

  exports: [

    WhatsappBaseService,

    WhatsappOutboundService,

    WhatsappProcessQueuedService,

    InternalCronService,

  ],

})

export class WhatsappModule {}


