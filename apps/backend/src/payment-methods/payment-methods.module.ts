import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { MedioPagoOpcion } from './entities/medio-pago-opcion.entity';
import { MedioPagoRapido } from './entities/medio-pago-rapido.entity';
import { MedioPago } from './entities/medio-pago.entity';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MedioPago, MedioPagoOpcion, MedioPagoRapido, ModuloConfig]),
    AuthModule,
  ],
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
