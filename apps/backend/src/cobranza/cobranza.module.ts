import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { Producto } from '../products/entities/producto.entity';
import { CobranzaReciboService } from './cobranza-recibo.service';
import { CobranzaController } from './cobranza.controller';
import { CobranzaService } from './cobranza.service';
import { CobranzaFactura } from './entities/cobranza-factura.entity';
import { CobranzaPago } from './entities/cobranza-pago.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CobranzaFactura,
      CobranzaPago,
      Comprobante,
      Cliente,
      CuentaCorriente,
      ModuloConfig,
      Tenant,
      Producto,
    ]),
    AuthModule,
    FacturacionModule,
  ],
  controllers: [CobranzaController],
  providers: [CobranzaService, CobranzaReciboService],
})
export class CobranzaModule {}
