import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Caja } from '../caja/entities/caja.entity';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { MpQrModule } from '../mp-qr/mp-qr.module';
import { MpTransferenciaMovimiento } from './entities/mp-transferencia-movimiento.entity';
import { MpTransferenciaVerificacion } from './entities/mp-transferencia-verificacion.entity';
import { MpTransferenciaController } from './mp-transferencia.controller';
import { MpTransferenciaService } from './mp-transferencia.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Comprobante,
      ComprobanteItem,
      MpTransferenciaMovimiento,
      MpTransferenciaVerificacion,
      Caja,
    ]),
    AuthModule,
    BranchesModule,
    FacturacionModule,
    MpQrModule,
  ],
  controllers: [MpTransferenciaController],
  providers: [MpTransferenciaService],
  exports: [MpTransferenciaService],
})
export class MpTransferenciaModule {}
