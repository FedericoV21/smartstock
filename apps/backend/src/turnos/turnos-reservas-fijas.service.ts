import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { Cliente } from '../catalog/entities/cliente.entity';
import { CreateReservaFijaDto } from './dto/create-reserva-fija.dto';
import { ListReservasFijasQueryDto } from './dto/list-reservas-fijas-query.dto';
import { TurnoAgendaDisponibilidad } from './entities/turno-agenda-disponibilidad.entity';
import { TurnoAgenda } from './entities/turno-agenda.entity';
import { TurnoReservaFija } from './entities/turno-reserva-fija.entity';
import { TurnosBaseService } from './turnos-base.service';
import { parseHoraReq, strOrNull, UUID_RE } from './utils/turnos-api.util';
import { serializeReservaFija } from './utils/turnos-serialize.util';
import {
  addDaysYmd,
  estaDisponible,
  minutesToTime,
  rangeDurationMinutes,
  timeToMinutes,
  type DisponibilidadSemanal,
  type ReservaFijaTurno,
} from './utils/turnos-slots.util';

function fechaReferenciaParaDia(diaSemana: number) {
  return addDaysYmd('2026-05-11', diaSemana - 1);
}

@Injectable()
export class TurnosReservasFijasService {
  constructor(
    @InjectRepository(TurnoAgenda) private readonly agendaRepo: Repository<TurnoAgenda>,
    @InjectRepository(TurnoAgendaDisponibilidad)
    private readonly disponibilidadRepo: Repository<TurnoAgendaDisponibilidad>,
    @InjectRepository(TurnoReservaFija) private readonly reservaFijaRepo: Repository<TurnoReservaFija>,
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    private readonly base: TurnosBaseService,
  ) {}

  async list(query: ListReservasFijasQueryDto) {
    await this.base.assertModuloTurnos();
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId(query.sucursal_id);

    const agendaId = query.agenda_id?.trim() ?? '';
    if (!UUID_RE.test(agendaId)) {
      throw new BadRequestException('agenda_id invalido');
    }

    const rows = await this.reservaFijaRepo.find({
      where: { tenantId, sucursalId, agendaId, activa: true },
      relations: ['cliente'],
      order: { diaSemana: 'ASC', horaInicio: 'ASC' },
    });

    return {
      reservas_fijas: rows.map(serializeReservaFija),
      sucursal_id: sucursalId,
    };
  }

  async create(dto: CreateReservaFijaDto, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    const agendaId = String(dto.agenda_id ?? '').trim();
    const diaSemana = Number(dto.dia_semana);
    const horaInicio = parseHoraReq(dto.hora_inicio);
    if (!UUID_RE.test(agendaId) || !Number.isInteger(diaSemana) || diaSemana < 1 || diaSemana > 7 || !horaInicio) {
      throw new BadRequestException('agenda_id, dia_semana y hora_inicio son requeridos');
    }

    const agenda = await this.agendaRepo.findOne({
      where: { id: agendaId, tenantId, sucursalId, activa: true },
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

    const clienteIdRaw = String(dto.cliente_id ?? '').trim();
    const clienteId = clienteIdRaw ? clienteIdRaw : null;
    if (clienteId && !UUID_RE.test(clienteId)) {
      throw new BadRequestException('cliente_id invalido');
    }

    let nombre = strOrNull(dto.nombre, 180);
    let telefono = strOrNull(dto.telefono, 80);
    let email = strOrNull(dto.email, 120);
    if (clienteId) {
      const cliente = await this.clienteRepo.findOne({
        where: { id: clienteId, tenantId },
      });
      if (!cliente) {
        throw new NotFoundException('Cliente no encontrado');
      }
      nombre = nombre ?? cliente.razonSocial ?? cliente.nombre;
      telefono = telefono ?? cliente.telefono ?? null;
      email = email ?? cliente.email ?? null;
    }
    if (!nombre) {
      throw new BadRequestException('El nombre de la reserva fija es obligatorio');
    }

    const [disponibilidad, reservasFijas] = await Promise.all([
      this.disponibilidadRepo.find({ where: { tenantId, agendaId } }),
      this.reservaFijaRepo.find({ where: { tenantId, agendaId, activa: true } }),
    ]);

    let reservasFijasParaCheck: ReservaFijaTurno[] = reservasFijas.map((r) => ({
      id: r.id,
      dia_semana: r.diaSemana,
      hora_inicio: r.horaInicio.slice(0, 5),
      hora_fin: r.horaFin.slice(0, 5),
      activa: r.activa,
      nombre: r.nombre,
    }));

    if (agenda.agendaPrincipalId) {
      const principalFijas = await this.reservaFijaRepo.find({
        where: { tenantId, agendaId: agenda.agendaPrincipalId, activa: true },
      });
      reservasFijasParaCheck = [
        ...reservasFijasParaCheck,
        ...principalFijas.map((r) => ({
          id: r.id,
          dia_semana: r.diaSemana,
          hora_inicio: r.horaInicio.slice(0, 5),
          hora_fin: r.horaFin.slice(0, 5),
          activa: r.activa,
          nombre: r.nombre,
        })),
      ];
    }

    const dispRows: DisponibilidadSemanal[] = disponibilidad.map((d) => ({
      id: d.id,
      dia_semana: d.diaSemana,
      hora_inicio: d.horaInicio.slice(0, 5),
      hora_fin: d.horaFin.slice(0, 5),
    }));

    const fechaReferencia = fechaReferenciaParaDia(diaSemana);
    const disponible = estaDisponible({
      fecha: fechaReferencia,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      disponibilidad: dispRows,
      bloqueos: [],
      reservas: [],
      reservasFijas: reservasFijasParaCheck,
    });
    if (!disponible) {
      throw new ConflictException('El horario no esta disponible para reserva fija');
    }

    try {
      const entity = this.reservaFijaRepo.create({
        tenantId,
        sucursalId,
        agendaId,
        clienteId,
        nombre,
        telefono,
        email,
        notas: strOrNull(dto.notas, 1000),
        diaSemana,
        horaInicio,
        horaFin,
        activa: true,
        createdBy: user.sub,
      });
      const saved = await this.reservaFijaRepo.save(entity);
      const withCliente = await this.reservaFijaRepo.findOne({
        where: { id: saved.id },
        relations: ['cliente'],
      });
      return { reserva_fija: serializeReservaFija(withCliente ?? saved) };
    } catch (e) {
      if (isUniqueConflict(e)) {
        throw new ConflictException('El horario ya tiene una reserva fija activa');
      }
      throw e;
    }
  }

  async softDelete(id: string, user: AccessTokenPayload) {
    await this.base.assertModuloTurnos();
    this.base.assertNotVisor(user);
    const tenantId = this.base.getTenantId();
    const sucursalId = await this.base.resolveSucursalId();

    if (!UUID_RE.test(id)) {
      throw new BadRequestException('Reserva fija invalida');
    }

    const result = await this.reservaFijaRepo.update(
      { id, tenantId, sucursalId, activa: true },
      { activa: false },
    );
    if (!result.affected) {
      throw new NotFoundException('Reserva fija no encontrada');
    }
    return { ok: true };
  }
}

function isUniqueConflict(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const code =
    (err as QueryFailedError & { code?: string; driverError?: { code?: string } }).code ??
    (err as QueryFailedError & { driverError?: { code?: string } }).driverError?.code;
  const msg = String(err.message ?? '');
  return code === '23505' || msg.includes('uq_turno_reserva_fija_slot_activo');
}
