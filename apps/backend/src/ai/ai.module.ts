import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ImportacionLog } from '../importaciones/entities/importacion-log.entity';
import { PricingModule } from '../pricing/pricing.module';
import { Producto } from '../products/entities/producto.entity';
import { AiExtractController } from './ai-extract.controller';
import { AiExtractService } from './ai-extract.service';
import { AiLimitController } from './ai-limit.controller';
import { AiLimitService } from './ai-limit.service';
import { AiPreviewController } from './ai-preview.controller';
import { AiPreviewService } from './ai-preview.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportacionLog, Tenant, ModuloConfig, Producto]),
    AuthModule,
    PricingModule,
  ],
  controllers: [AiLimitController, AiExtractController, AiPreviewController],
  providers: [AiLimitService, AiExtractService, AiPreviewService],
  exports: [AiLimitService],
})
export class AiModule {}
