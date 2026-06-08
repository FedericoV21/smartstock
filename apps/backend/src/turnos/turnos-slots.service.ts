import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TurnoAgendaDisponibilidad } from './entities/turno-agenda-disponibilidad.entity';
import { TurnoAgendaExtraHorario } from './entities/turno-agenda-extra-horario.entity';
import { TurnoAgenda } from './entities/turno-agenda.entity';
import { TurnoBloqueo } from './entities/turno-bloqueo.entity';
import { TurnoReservaFija } from './entities/turno-reserva-fija.entity';
import { TurnoReserva } from './entities/turno-reserva.entity';
import { TurnoReservaEstado } from './enums/turno-reserva-estado.enum';
import { ListSlotsQueryDto } from './dto/list-slots-query.dto';
import { TurnosBaseService } from './turnos-base.service';
import { parseFechaYmd, UUID_RE } from './utils/turnos-api.util';
import { serializeAgenda, serializeBloqueo, serializeExtraHorario, serializeReserva, serializeReservaFija } from './utils/turnos-serialize.util';
import {
  addDaysYmd,
  generarSlotsParaFecha,
  listarFechas,
  type BloqueoTurno,
  type DisponibilidadSemanal,
  type ExtraHorarioTurno,
  type ReservaFijaTurno,
  type ReservaTurno,
} from './utils/turnos-slots.util';

@Injectable()
export class TurnosSlotsService {
  constructor(
    @InjectRepository(TurnoAgenda) private readonly agendaRepo: Repository<TurnoAgenda>,
    @InjectRepository(TurnoAgendaDisponibilidad)
    private readonly disponibilidadRepo: Repository<TurnoAgendaDisponibilidad>,
    @InjectRepository(TurnoAgendaExtraHorario)
    private readonly extraHorarioRepo: Repository<TurnoAgendaExtraHorario>,
    @InjectRepository(TurnoBloqueo) private readonly bloqueoRepo: Repository<TurnoBloqueo>,
    @InjectRepository(TurnoReserva) private readonly reservaRepo: Repository<TurnoReserva>,
    @InjectRepository(TurnoReservaFija) private readonly reservaFijaRepo: Repository<TurnoReservaFija>,
    private readonly base: TurnosBaseService,
  ) {}

  async list(query: ListSlotsQueryDto) {
    await this.base.assertModuloTurnos();
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId(query.sucursal_id);

    const agendaId = query.agenda_id?.trim() ?? '';
    const desde = parseFechaYmd(query.desde);
    const hasta = parseFechaYmd(query.hasta) ?? desde;
    if (!UUID_RE.test(agendaId) || !desde || !hasta) {
      throw new BadRequestException('agenda_id, desde y hasta son requeridos');
    }

    const fechas = listarFechas(desde, hasta, 31);
    if (fechas.length === 0) {
      throw new BadRequestException('Rango de fechas invalido');
    }

    const agenda = await this.agendaRepo.findOne({
      where: { id: agendaId, tenantId, sucursalId },
    });
    if (!agenda) {
      throw new NotFoundException('Agenda no encontrada');
    }

    const desdeConsulta = addDaysYmd(desde, -1);
    const hastaConsulta = addDaysYmd(hasta, 1);

    const [disponibilidad, bloqueos, reservas, reservasFijas, extrasHorarios] = await Promise.all([
      this.disponibilidadRepo.find({ where: { tenantId, agendaId } }),
      this.bloqueoRepo
        .createQueryBuilder('b')
        .where('b.tenant_id = :tenantId', { tenantId })
        .andWhere('b.agenda_id = :agendaId', { agendaId })
        .andWhere('b.fecha >= :desde', { desde: desdeConsulta })
        .andWhere('b.fecha <= :hasta', { hasta: hastaConsulta })
        .getMany(),
      this.reservaRepo
        .createQueryBuilder('r')
        .leftJoinAndSelect('r.cliente', 'cliente')
        .where('r.tenant_id = :tenantId', { tenantId })
        .andWhere('r.agenda_id = :agendaId', { agendaId })
        .andWhere('r.fecha >= :desde', { desde: desdeConsulta })
        .andWhere('r.fecha <= :hasta', { hasta: hastaConsulta })
        .andWhere('r.estado != :cancelado', { cancelado: TurnoReservaEstado.cancelado })
        .getMany(),
      this.reservaFijaRepo.find({
        where: { tenantId, agendaId, activa: true },
        relations: ['cliente'],
      }),
      this.extraHorarioRepo.find({ where: { tenantId, agendaId, activa: true } }),
    ]);

    const dispRows: DisponibilidadSemanal[] = disponibilidad.map((d) => ({
      id: d.id,
      dia_semana: d.diaSemana,
      hora_inicio: d.horaInicio.slice(0, 5),
      hora_fin: d.horaFin.slice(0, 5),
    }));
    const bloqueoRows: BloqueoTurno[] = bloqueos.map((b) => ({
      id: b.id,
      fecha: b.fecha,
      hora_inicio: b.horaInicio.slice(0, 5),
      hora_fin: b.horaFin.slice(0, 5),
      motivo: b.motivo,
    }));
    let reservaRows: ReservaTurno[] = reservas.map((r) => ({
      id: r.id,
      fecha: r.fecha,
      hora_inicio: r.horaInicio.slice(0, 5),
      hora_fin: r.horaFin.slice(0, 5),
      estado: r.estado,
      nombre: r.nombre,
    }));
    let reservaFijaRows: ReservaFijaTurno[] = reservasFijas.map((r) => ({
      id: r.id,
      dia_semana: r.diaSemana,
      hora_inicio: r.horaInicio.slice(0, 5),
      hora_fin: r.horaFin.slice(0, 5),
      activa: r.activa,
      nombre: r.nombre,
    }));
    const extrasRows: ExtraHorarioTurno[] = extrasHorarios.map((e) => ({
      id: e.id,
      dia_semana: e.diaSemana,
      hora_inicio: e.horaInicio.slice(0, 5),
      hora_fin: e.horaFin.slice(0, 5),
      extra_monto: Number(e.extraMonto),
      activa: e.activa,
    }));

    if (agenda.agendaPrincipalId) {
      const [reservasPrincipal, reservasFijasPrincipal] = await Promise.all([
        this.reservaRepo
          .createQueryBuilder('r')
          .where('r.tenant_id = :tenantId', { tenantId })
          .andWhere('r.agenda_id = :agendaId', { agendaId: agenda.agendaPrincipalId })
          .andWhere('r.fecha >= :desde', { desde: desdeConsulta })
          .andWhere('r.fecha <= :hasta', { hasta: hastaConsulta })
          .andWhere('r.estado != :cancelado', { cancelado: TurnoReservaEstado.cancelado })
          .getMany(),
        this.reservaFijaRepo.find({
          where: { tenantId, agendaId: agenda.agendaPrincipalId, activa: true },
        }),
      ]);
      reservaRows = [
        ...reservaRows,
        ...reservasPrincipal.map((r) => ({
          id: r.id,
          fecha: r.fecha,
          hora_inicio: r.horaInicio.slice(0, 5),
          hora_fin: r.horaFin.slice(0, 5),
          estado: r.estado,
          nombre: r.nombre,
        })),
      ];
      reservaFijaRows = [
        ...reservaFijaRows,
        ...reservasFijasPrincipal.map((r) => ({
          id: r.id,
          dia_semana: r.diaSemana,
          hora_inicio: r.horaInicio.slice(0, 5),
          hora_fin: r.horaFin.slice(0, 5),
          activa: r.activa,
          nombre: r.nombre,
        })),
      ];
    }

    const slots = fechas.flatMap((fecha) =>
      generarSlotsParaFecha({
        fecha,
        duracionMinutos: Number(agenda.duracionMinutos ?? 60),
        disponibilidad: dispRows,
        bloqueos: bloqueoRows,
        reservas: reservaRows,
        reservasFijas: reservaFijaRows,
        extrasHorarios: extrasRows,
        precioBase: Number(agenda.precio ?? 0),
      }),
    );

    return {
      agenda: serializeAgenda({ ...agenda, disponibilidad: [], extrasHorarios: [], reservasFijas: [] }),
      slots,
      reservas: reservas.map(serializeReserva),
      reservas_fijas: reservasFijas.map(serializeReservaFija),
      extras_horarios: extrasHorarios.map(serializeExtraHorario),
      bloqueos: bloqueos.map(serializeBloqueo),
      sucursal_id: sucursalId,
    };
  }
}
