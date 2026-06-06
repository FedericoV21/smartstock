import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Producto } from '../products/entities/producto.entity';
import { PrecioHistorial } from './entities/precio-historial.entity';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  imports: [TypeOrmModule.forFeature([PrecioHistorial, Producto, ModuloConfig]), AuthModule],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
