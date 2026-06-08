import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { CreateBloqueoDto } from './dto/create-bloqueo.dto';
import { ListBloqueosQueryDto } from './dto/list-bloqueos-query.dto';
import { TurnoAgenda } from './entities/turno-agenda.entity';
import { TurnoBloqueo } from './entities/turno-bloqueo.entity';
import { TurnoReservaFija } from './entities/turno-reserva-fija.entity';
import { TurnoReserva } from './entities/turno-reserva.entity';
import { TurnoReservaEstado } from './enums/turno-reserva-estado.enum';
import { TurnosBaseService } from './turnos-base.service';
import { parseFechaYmd, parseHoraReq, strOrNull, UUID_RE } from './utils/turnos-api.util';
import { serializeBloqueo } from './utils/turnos-serialize.util';
import {
  addDaysYmd,
  minutesToTime,
  rangeDurationMinutes,
  reservasFijasParaFecha,
  timeToMinutes,
  turnosOverlap,
  type ReservaFijaTurno,
} from './utils/turnos-slots.util';

@Injectable()
export class TurnosBloqueosService {
  constructor(
    @InjectRepository(TurnoAgenda) private readonly agendaRepo: Repository<TurnoAgenda>,
    @InjectRepository(TurnoBloqueo) private readonly bloqueoRepo: Repository<TurnoBloqueo>,
    @InjectRepository(TurnoReserva) private readonly reservaRepo: Repository<TurnoReserva>,
    @InjectRepository(TurnoReservaFija) private readonly reservaFijaRepo: Repository<TurnoReservaFija>,
    private readonly base: TurnosBaseService,
  ) {}

  async list(query: ListBloqueosQueryDto) {
    await this.base.assertModuloTurnos();
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId(query.sucursal_id);

    const agendaId = query.agenda_id?.trim() ?? '';
    const desde = parseFechaYmd(query.desde);
    const hasta = parseFechaYmd(query.hasta) ?? desde;
    if (!UUID_RE.test(agendaId) || !desde || !hasta) {
      throw new BadRequestException('agenda_id, desde y hasta son requeridos');
    }

    const agenda = await this.agendaRepo.findOne({
      where: { id: agendaId, tenantId, sucursalId },
      select: { id: true },
    });
    if (!agenda) {
      throw new NotFoundException('Agenda no encontrada');
    }

    const bloqueos = await this.bloqueoRepo.find({
      where: { tenantId, agendaId },
      order: { fecha: 'ASC', horaInicio: 'ASC' },
    });
    const filtered = bloqueos.filter((b) => b.fecha >= desde && b.fecha <= hasta);

    return {
      bloqueos: filtered.map(serializeBloqueo),
      sucursal_id: sucursalId,
    };
  }

  async create(dto: CreateBloqueoDto, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    const agendaId = String(dto.agenda_id ?? '').trim();
    const fecha = parseFechaYmd(dto.fecha);
    const horaInicio = parseHoraReq(dto.hora_inicio);
    if (!UUID_RE.test(agendaId) || !fecha || !horaInicio) {
      throw new BadRequestException('agenda_id, fecha y hora_inicio son requeridos');
    }

    const agenda = await this.agendaRepo.findOne({
      where: { id: agendaId, tenantId, sucursalId },
      select: { id: true, duracionMinutos: true },
    });
    if (!agenda) {
      throw new NotFoundException('Agenda no encontrada');
    }

    const inicioMin = timeToMinutes(horaInicio);
    const horaFinBody = parseHoraReq(dto.hora_fin);
    const horaFin =
      horaFinBody ??
      (inicioMin == null ? null : minutesToTime(inicioMin + Number(agenda.duracionMinutos ?? 60)));
    if (!horaFin || inicioMin == null || rangeDurationMinutes(horaInicio, horaFin) == null) {
      throw new BadRequestException('Rango horario invalido');
    }

    const fechaDesdeCheck = addDaysYmd(fecha, -1);
    const fechaHastaCheck = addDaysYmd(fecha, 1);
    const requested = { fecha, hora_inicio: horaInicio, hora_fin: horaFin };

    const [reservas, reservasFijas] = await Promise.all([
      this.reservaRepo.find({
        where: {
          tenantId,
          agendaId,
          estado: Not(TurnoReservaEstado.cancelado),
        },
      }),
      this.reservaFijaRepo.find({
        where: { tenantId, agendaId, activa: true },
      }),
    ]);

    const reservasRango = reservas.filter(
      (r) => r.fecha >= fechaDesdeCheck && r.fecha <= fechaHastaCheck,
    );
    if (
      reservasRango.some((r) =>
        turnosOverlap(requested, {
          fecha: r.fecha,
          hora_inicio: r.horaInicio.slice(0, 5),
          hora_fin: r.horaFin.slice(0, 5),
        }),
      )
    ) {
      throw new ConflictException('El horario tiene una reserva activa');
    }

    const fijasRows: ReservaFijaTurno[] = reservasFijas.map((r) => ({
      id: r.id,
      dia_semana: r.diaSemana,
      hora_inicio: r.horaInicio.slice(0, 5),
      hora_fin: r.horaFin.slice(0, 5),
      activa: r.activa,
      nombre: r.nombre,
    }));
    if (
      reservasFijasParaFecha(fecha, fijasRows).some((r) => turnosOverlap(requested, r))
    ) {
      throw new ConflictException('El horario tiene una reserva fija activa');
    }

    const bloqueo = this.bloqueoRepo.create({
      tenantId,
      agendaId,
      fecha,
      horaInicio,
      horaFin,
      motivo: strOrNull(dto.motivo, 300),
      createdBy: user.sub,
    });
    const saved = await this.bloqueoRepo.save(bloqueo);
    return { bloqueo: serializeBloqueo(saved) };
  }

  async delete(id: string, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    if (!UUID_RE.test(id)) {
      throw new BadRequestException('Bloqueo invalido');
    }

    const bloqueo = await this.bloqueoRepo.findOne({
      where: { id, tenantId },
      select: { id: true, agendaId: true },
    });
    if (!bloqueo) {
      throw new NotFoundException('Bloqueo no encontrado');
    }

    const agenda = await this.agendaRepo.findOne({
      where: { id: bloqueo.agendaId, tenantId, sucursalId },
      select: { id: true },
    });
    if (!agenda) {
      throw new NotFoundException('Agenda no encontrada');
    }

    await this.bloqueoRepo.delete({ id, tenantId });
    return { ok: true };
  }
}
