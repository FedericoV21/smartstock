import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FacturacionModule } from '../facturacion/facturacion.module';
import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { ArcaAdminService } from './arca-admin.service';
import { ArcaHomologationService } from './arca-homologation.service';
import { ArcaController } from './arca.controller';
import { ArcaJobWorkerService } from './arca-job-worker.service';
import { ArcaService } from './arca.service';
import { ArcaWorkerController } from './arca-worker.controller';
import { ArcaConfig } from './entities/arca-config.entity';
import { ArcaLog } from './entities/arca-log.entity';
import { ArcaCryptoService } from './crypto/arca-crypto.service';
import { ArcaWsaaService } from './wsaa/arca-wsaa.service';
import { ArcaNumeracionPreCaeService } from './wsfe/arca-numeracion-pre-cae.service';
import { ArcaSolicitarCaeOrchestratorService } from './wsfe/arca-solicitar-cae-orchestrator.service';
import { ArcaWsfeConsultaService } from './wsfe/arca-wsfe-consulta.service';
import { ArcaWsfeService } from './wsfe/arca-wsfe.service';
import { Comprobante } from '../facturacion/entities/comprobante.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ArcaConfig, ArcaLog, Comprobante, ModuloConfig]),
    AuthModule,
    BranchesModule,
    forwardRef(() => FacturacionModule),
  ],
  controllers: [ArcaController, ArcaWorkerController],
  providers: [
    ArcaService,
    ArcaAdminService,
    ArcaCryptoService,
    ArcaWsaaService,
    ArcaWsfeConsultaService,
    ArcaNumeracionPreCaeService,
    ArcaSolicitarCaeOrchestratorService,
    ArcaWsfeService,
    ArcaJobWorkerService,
    ArcaHomologationService,
  ],
  exports: [ArcaWsfeService, ArcaSolicitarCaeOrchestratorService, ArcaJobWorkerService],
})
export class ArcaModule {}
