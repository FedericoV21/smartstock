import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Cliente } from '../catalog/entities/cliente.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Producto } from '../products/entities/producto.entity';
import { TurnoAgendaDisponibilidad } from './entities/turno-agenda-disponibilidad.entity';
import { TurnoAgendaExtraHorario } from './entities/turno-agenda-extra-horario.entity';
import { TurnoAgenda } from './entities/turno-agenda.entity';
import { TurnoBloqueo } from './entities/turno-bloqueo.entity';
import { TurnoReservaFija } from './entities/turno-reserva-fija.entity';
import { TurnoReserva } from './entities/turno-reserva.entity';
import { TurnosAgendasService } from './turnos-agendas.service';
import { TurnosBaseService } from './turnos-base.service';
import { TurnosBloqueosService } from './turnos-bloqueos.service';
import { TurnosController } from './turnos.controller';
import { TurnosReservasFijasService } from './turnos-reservas-fijas.service';
import { TurnosReservasService } from './turnos-reservas.service';
import { TurnosSlotsService } from './turnos-slots.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TurnoAgenda,
      TurnoAgendaDisponibilidad,
      TurnoAgendaExtraHorario,
      TurnoBloqueo,
      TurnoReserva,
      TurnoReservaFija,
      Producto,
      Cliente,
      Comprobante,
      ModuloConfig,
      Tenant,
    ]),
    AuthModule,
    BranchesModule,
    FacturacionModule,
  ],
  controllers: [TurnosController],
  providers: [
    TurnosBaseService,
    TurnosAgendasService,
    TurnosBloqueosService,
    TurnosReservasService,
    TurnosReservasFijasService,
    TurnosSlotsService,
  ],
})
export class TurnosModule {}
