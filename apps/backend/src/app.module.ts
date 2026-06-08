import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ArcaModule } from './arca/arca.module';
import { BranchesModule } from './branches/branches.module';
import { CatalogModule } from './catalog/catalog.module';
import { TenantConfigModule } from './config/config.module';
import { AuthModule } from './auth/auth.module';
import { envValidationSchema } from './config/env.validation';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { getTypeOrmOptions } from './database/typeorm.config';
import { FacturacionModule } from './facturacion/facturacion.module';
import { HealthModule } from './health/health.module';
import { ImportacionesModule } from './importaciones/importaciones.module';
import { InventoryModule } from './inventory/inventory.module';
import { PedidosModule } from './pedidos/pedidos.module';
import { PricingModule } from './pricing/pricing.module';
import { ProductsModule } from './products/products.module';
import { PromotionsModule } from './promotions/promotions.module';
import { AiModule } from './ai/ai.module';
import { CuentaCorrienteModule } from './cuenta-corriente/cuenta-corriente.module';
import { AnalyzerModule } from './analyzer/analyzer.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { TesoreriaModule } from './tesoreria/tesoreria.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { CajaModule } from './caja/caja.module';
import { PosModule } from './pos/pos.module';
import { PresupuestosModule } from './presupuestos/presupuestos.module';
import { CobranzaModule } from './cobranza/cobranza.module';
import { MpPointModule } from './mp-point/mp-point.module';
import { MpQrModule } from './mp-qr/mp-qr.module';
import { MpTransferenciaModule } from './mp-transferencia/mp-transferencia.module';
import { PasarelasModule } from './pasarelas/pasarelas.module';
import { CronModule } from './cron/cron.module';
import { TurnosModule } from './turnos/turnos.module';
import { LectorFacturasModule } from './lector-facturas/lector-facturas.module';
import { DespieceModule } from './despiece/despiece.module';
import { NexusDashboardModule } from './nexus-dashboard/nexus-dashboard.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validationSchema: envValidationSchema,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL_MS', 60_000),
          limit: config.get<number>('THROTTLE_LIMIT', 120),
        },
      ],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: async () => getTypeOrmOptions(),
    }),
    AuthModule,
    HealthModule,
    CatalogModule,
    BranchesModule,
    TenantConfigModule,
    ProductsModule,
    InventoryModule,
    FacturacionModule,
    ArcaModule,
    ImportacionesModule,
    PedidosModule,
    PricingModule,
    PromotionsModule,
    AiModule,
    CuentaCorrienteModule,
    ReportsModule,
    DashboardModule,
    AnalyzerModule,
    TesoreriaModule,
    PaymentMethodsModule,
    CajaModule,
    PosModule,
    PresupuestosModule,
    CobranzaModule,
    MpPointModule,
    MpQrModule,
    MpTransferenciaModule,
    PasarelasModule,
    CronModule,
    TurnosModule,
    WhatsappModule,
    LectorFacturasModule,
    DespieceModule,
    NexusDashboardModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
