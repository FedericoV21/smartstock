import { Cliente } from '../../catalog/entities/cliente.entity';
import { TurnoAgendaDisponibilidad } from '../entities/turno-agenda-disponibilidad.entity';
import { TurnoAgendaExtraHorario } from '../entities/turno-agenda-extra-horario.entity';
import { TurnoAgenda } from '../entities/turno-agenda.entity';
import { TurnoBloqueo } from '../entities/turno-bloqueo.entity';
import { TurnoReservaFija } from '../entities/turno-reserva-fija.entity';
import { TurnoReserva } from '../entities/turno-reserva.entity';

function hora(value: string | null | undefined): string {
  return String(value ?? '').slice(0, 5);
}

function num(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function serializeClienteBrief(cliente: Cliente | null | undefined) {
  if (!cliente) return null;
  return {
    id: cliente.id,
    nombre: cliente.nombre,
    razon_social: cliente.razonSocial ?? null,
    telefono: cliente.telefono ?? null,
    email: cliente.email ?? null,
  };
}

export function serializeDisponibilidad(row: TurnoAgendaDisponibilidad) {
  return {
    id: row.id,
    dia_semana: row.diaSemana,
    hora_inicio: hora(row.horaInicio),
    hora_fin: hora(row.horaFin),
  };
}

export function serializeExtraHorario(row: TurnoAgendaExtraHorario) {
  return {
    id: row.id,
    dia_semana: row.diaSemana,
    hora_inicio: hora(row.horaInicio),
    hora_fin: hora(row.horaFin),
    extra_monto: num(row.extraMonto),
    descripcion: row.descripcion ?? null,
    activa: row.activa,
  };
}

export function serializeReservaFijaBrief(row: TurnoReservaFija) {
  return {
    id: row.id,
    cliente_id: row.clienteId,
    nombre: row.nombre,
    telefono: row.telefono ?? null,
    email: row.email ?? null,
    notas: row.notas ?? null,
    dia_semana: row.diaSemana,
    hora_inicio: hora(row.horaInicio),
    hora_fin: hora(row.horaFin),
    activa: row.activa,
  };
}

export function serializeAgenda(agenda: TurnoAgenda) {
  return {
    id: agenda.id,
    tenant_id: agenda.tenantId,
    sucursal_id: agenda.sucursalId,
    producto_id: agenda.productoId,
    agenda_principal_id: agenda.agendaPrincipalId,
    nombre: agenda.nombre,
    descripcion: agenda.descripcion ?? null,
    precio: num(agenda.precio),
    duracion_minutos: agenda.duracionMinutos,
    activa: agenda.activa,
    created_at: agenda.createdAt?.toISOString?.() ?? agenda.createdAt,
    updated_at: agenda.updatedAt?.toISOString?.() ?? agenda.updatedAt,
    disponibilidad: (agenda.disponibilidad ?? []).map(serializeDisponibilidad),
    extras_horarios: (agenda.extrasHorarios ?? []).map(serializeExtraHorario),
    reservas_fijas: (agenda.reservasFijas ?? []).map(serializeReservaFijaBrief),
  };
}

export function serializeAgendaBrief(agenda: TurnoAgenda | null | undefined) {
  if (!agenda) return null;
  return {
    id: agenda.id,
    nombre: agenda.nombre,
    precio: num(agenda.precio),
  };
}

export function serializeReserva(reserva: TurnoReserva) {
  return {
    id: reserva.id,
    tenant_id: reserva.tenantId,
    sucursal_id: reserva.sucursalId,
    agenda_id: reserva.agendaId,
    cliente_id: reserva.clienteId,
    nombre: reserva.nombre,
    telefono: reserva.telefono ?? null,
    email: reserva.email ?? null,
    notas: reserva.notas ?? null,
    fecha: reserva.fecha,
    hora_inicio: hora(reserva.horaInicio),
    hora_fin: hora(reserva.horaFin),
    precio_snapshot: num(reserva.precioSnapshot),
    sena_monto: num(reserva.senaMonto),
    estado: reserva.estado,
    comprobante_id: reserva.comprobanteId,
    created_at: reserva.createdAt?.toISOString?.() ?? reserva.createdAt,
    updated_at: reserva.updatedAt?.toISOString?.() ?? reserva.updatedAt,
    created_by: reserva.createdBy,
    cancelado_at: reserva.canceladoAt?.toISOString?.() ?? reserva.canceladoAt ?? null,
    cancelado_por: reserva.canceladoPor,
    agenda: serializeAgendaBrief(reserva.agenda),
    cliente: serializeClienteBrief(reserva.cliente),
  };
}

export function serializeReservaFija(reserva: TurnoReservaFija) {
  return {
    ...serializeReservaFijaBrief(reserva),
    tenant_id: reserva.tenantId,
    sucursal_id: reserva.sucursalId,
    agenda_id: reserva.agendaId,
    created_at: reserva.createdAt?.toISOString?.() ?? reserva.createdAt,
    updated_at: reserva.updatedAt?.toISOString?.() ?? reserva.updatedAt,
    created_by: reserva.createdBy,
    cliente: serializeClienteBrief(reserva.cliente),
  };
}

export function serializeBloqueo(bloqueo: TurnoBloqueo) {
  return {
    id: bloqueo.id,
    tenant_id: bloqueo.tenantId,
    agenda_id: bloqueo.agendaId,
    fecha: bloqueo.fecha,
    hora_inicio: hora(bloqueo.horaInicio),
    hora_fin: hora(bloqueo.horaFin),
    motivo: bloqueo.motivo ?? null,
    created_at: bloqueo.createdAt?.toISOString?.() ?? bloqueo.createdAt,
    created_by: bloqueo.createdBy,
  };
}
