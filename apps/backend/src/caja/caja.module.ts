import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { UsersModule } from '../users/users.module';
import { CajaCierreService } from './caja-cierre.service';
import { CajaController } from './caja.controller';
import { CajaSnapshotService } from './caja-snapshot.service';
import { CajaService } from './caja.service';
import { CajaApertura } from './entities/caja-apertura.entity';
import { CajaTurno } from './entities/caja-turno.entity';
import { CajaUsuario } from './entities/caja-usuario.entity';
import { Caja } from './entities/caja.entity';
import { CierreZMedioPago } from './entities/cierre-z-medio-pago.entity';
import { CierreZ } from './entities/cierre-z.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Caja,
      CajaUsuario,
      CajaTurno,
      CajaApertura,
      CierreZ,
      CierreZMedioPago,
      Sucursal,
      ModuloConfig,
      Comprobante,
    ]),
    AuthModule,
    BranchesModule,
    UsersModule,
  ],
  controllers: [CajaController],
  providers: [CajaService, CajaCierreService, CajaSnapshotService],
  exports: [CajaService],
})
export class CajaModule {}
