export type DisponibilidadSemanal = {
  id?: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
};

export type BloqueoTurno = {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  motivo?: string | null;
};

export type ReservaTurno = {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: string;
  nombre?: string | null;
};

export type ReservaFijaTurno = {
  id: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  activa?: boolean | null;
  nombre?: string | null;
};

export type ExtraHorarioTurno = {
  id?: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  extra_monto: number | string;
  activa?: boolean | null;
};

export type SlotTurno = {
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: 'disponible' | 'reservado' | 'bloqueado';
  reserva_id: string | null;
  reserva_fija_id: string | null;
  bloqueo_id: string | null;
  precio_extra: number;
  precio_total: number;
};

const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const MINUTOS_DIA = 24 * 60;

export function timeToMinutes(value: string): number | null {
  const m = HORA_RE.exec(String(value ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToTime(minutes: number): string {
  const normalized = ((Math.round(minutes) % MINUTOS_DIA) + MINUTOS_DIA) % MINUTOS_DIA;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function normalizarHora(value: string): string | null {
  const mins = timeToMinutes(value);
  return mins == null ? null : minutesToTime(mins);
}

export function rangeDurationMinutes(start: string, end: string): number | null {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s == null || e == null || s === e) return null;
  return e > s ? e - s : e + MINUTOS_DIA - s;
}

export function rangeCrossesMidnight(start: string, end: string): boolean {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  return s != null && e != null && e < s;
}

function ymdDayNumber(fechaYmd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaYmd)) return null;
  const [y, m, d] = fechaYmd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return Math.floor(date.getTime() / 86_400_000);
}

function rangeToAbsoluteMinutes(
  fecha: string,
  horaInicio: string,
  horaFin: string,
  baseFecha: string,
): { start: number; end: number } | null {
  const day = ymdDayNumber(fecha);
  const base = ymdDayNumber(baseFecha);
  const startMin = timeToMinutes(horaInicio);
  const endMin = timeToMinutes(horaFin);
  if (day == null || base == null || startMin == null || endMin == null || startMin === endMin) {
    return null;
  }
  const offset = (day - base) * MINUTOS_DIA;
  return {
    start: offset + startMin,
    end: offset + (endMin > startMin ? endMin : endMin + MINUTOS_DIA),
  };
}

function rangeToServiceDayMinutes(
  horaInicio: string,
  horaFin: string,
  row?: DisponibilidadSemanal,
): { start: number; end: number } | null {
  const startMin = timeToMinutes(horaInicio);
  const endMin = timeToMinutes(horaFin);
  if (startMin == null || endMin == null || startMin === endMin) return null;

  let start = startMin;
  let end = endMin > startMin ? endMin : endMin + MINUTOS_DIA;
  const rowStart = row ? timeToMinutes(row.hora_inicio) : null;
  const rowEnd = row ? timeToMinutes(row.hora_fin) : null;
  const rowCrosses = rowStart != null && rowEnd != null && rowEnd < rowStart;

  if (rowCrosses && startMin < rowEnd) {
    start += MINUTOS_DIA;
    end += MINUTOS_DIA;
  }

  return { start, end };
}

function absoluteRangesForTurno(turno: { fecha: string; hora_inicio: string; hora_fin: string }, baseFecha: string) {
  const range = rangeToAbsoluteMinutes(turno.fecha, turno.hora_inicio, turno.hora_fin, baseFecha);
  if (!range) return [];

  const startMin = timeToMinutes(turno.hora_inicio);
  const endMin = timeToMinutes(turno.hora_fin);
  if (startMin == null || endMin == null) return [range];

  const ranges = [range];
  if (turno.fecha === baseFecha && endMin > startMin) {
    ranges.push({
      start: range.start + MINUTOS_DIA,
      end: range.end + MINUTOS_DIA,
    });
  }
  return ranges;
}

export function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  const a = rangeToAbsoluteMinutes('2000-01-01', startA, endA, '2000-01-01');
  const b = rangeToAbsoluteMinutes('2000-01-01', startB, endB, '2000-01-01');
  if (!a || !b) return false;
  return a.start < b.end && a.end > b.start;
}

export function turnosOverlap(
  a: { fecha: string; hora_inicio: string; hora_fin: string },
  b: { fecha: string; hora_inicio: string; hora_fin: string },
): boolean {
  const base = a.fecha <= b.fecha ? a.fecha : b.fecha;
  const rangosA = absoluteRangesForTurno(a, base);
  const rangosB = absoluteRangesForTurno(b, base);
  return rangosA.some((rangoA) =>
    rangosB.some((rangoB) => rangoA.start < rangoB.end && rangoA.end > rangoB.start),
  );
}

export function diaSemanaIso(fechaYmd: string): number {
  const d = new Date(`${fechaYmd}T12:00:00-03:00`);
  if (!Number.isFinite(d.getTime())) return 0;
  const day = d.getDay();
  return day === 0 ? 7 : day;
}

export function addDaysYmd(fechaYmd: string, days: number): string {
  const d = new Date(`${fechaYmd}T12:00:00-03:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function listarFechas(desde: string, hasta: string, maxDias = 31): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return [];
  }
  const out: string[] = [];
  let cur = desde;
  for (let i = 0; i < maxDias && cur <= hasta; i += 1) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

export function reservasFijasParaFecha(fecha: string, reservasFijas: ReservaFijaTurno[] = []): ReservaTurno[] {
  const dia = diaSemanaIso(fecha);
  if (!dia) return [];
  return reservasFijas
    .filter((reserva) => reserva.activa !== false && Number(reserva.dia_semana) === dia)
    .map((reserva) => ({
      id: reserva.id,
      fecha,
      hora_inicio: reserva.hora_inicio,
      hora_fin: reserva.hora_fin,
      estado: 'reservado',
      nombre: reserva.nombre ?? 'Reserva fija',
    }));
}

function extraHorarioOverlap(
  fecha: string,
  horaInicio: string,
  horaFin: string,
  extra: ExtraHorarioTurno,
): boolean {
  const dia = diaSemanaIso(fecha);
  if (!dia || extra.activa === false || Number(extra.dia_semana) !== dia) return false;
  const requested = rangeToServiceDayMinutes(horaInicio, horaFin, extra);
  const extraRange = rangeToServiceDayMinutes(extra.hora_inicio, extra.hora_fin);
  return !!requested && !!extraRange && requested.start < extraRange.end && requested.end > extraRange.start;
}

export function calcularExtraHorario(opts: {
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  extrasHorarios?: ExtraHorarioTurno[];
}): number {
  const total = (opts.extrasHorarios ?? [])
    .filter((extra) => extraHorarioOverlap(opts.fecha, opts.hora_inicio, opts.hora_fin, extra))
    .reduce((acc, extra) => {
      const monto = typeof extra.extra_monto === 'number'
        ? extra.extra_monto
        : Number(String(extra.extra_monto ?? '').replace(',', '.'));
      return acc + (Number.isFinite(monto) && monto > 0 ? monto : 0);
    }, 0);
  return Math.round(total * 100) / 100;
}

export function generarSlotsParaFecha(opts: {
  fecha: string;
  duracionMinutos: number;
  disponibilidad: DisponibilidadSemanal[];
  bloqueos: BloqueoTurno[];
  reservas: ReservaTurno[];
  reservasFijas?: ReservaFijaTurno[];
  extrasHorarios?: ExtraHorarioTurno[];
  precioBase?: number;
}): SlotTurno[] {
  const dia = diaSemanaIso(opts.fecha);
  const dur = Number.isFinite(opts.duracionMinutos) && opts.duracionMinutos > 0
    ? Math.round(opts.duracionMinutos)
    : 60;
  const rows = opts.disponibilidad
    .filter((row) => Number(row.dia_semana) === dia)
    .map((row) => {
      const range = rangeToServiceDayMinutes(row.hora_inicio, row.hora_fin);
      return range ? { row, range } : null;
    })
    .filter((item): item is { row: DisponibilidadSemanal; range: { start: number; end: number } } => item != null)
    .sort((a, b) => a.range.start - b.range.start);
  const slots: SlotTurno[] = [];
  const reservasFijas = reservasFijasParaFecha(opts.fecha, opts.reservasFijas);
  const precioBase = Number.isFinite(opts.precioBase) && opts.precioBase != null
    ? Math.max(0, Math.round(opts.precioBase * 100) / 100)
    : 0;

  for (const { range } of rows) {
    for (let cur = range.start; cur + dur <= range.end; cur += dur) {
      const hora_inicio = minutesToTime(cur);
      const hora_fin = minutesToTime(cur + dur);
      const slotRange = { fecha: opts.fecha, hora_inicio, hora_fin };
      const reserva = opts.reservas.find(
        (r) =>
          r.estado !== 'cancelado' &&
          turnosOverlap(slotRange, r),
      );
      const reservaFija = reserva
        ? null
        : reservasFijas.find((r) => turnosOverlap(slotRange, r));
      const bloqueo = opts.bloqueos.find(
        (b) =>
          turnosOverlap(slotRange, b),
      );
      const precioExtra = calcularExtraHorario({
        fecha: opts.fecha,
        hora_inicio,
        hora_fin,
        extrasHorarios: opts.extrasHorarios,
      });
      slots.push({
        fecha: opts.fecha,
        hora_inicio,
        hora_fin,
        estado: reserva || reservaFija ? 'reservado' : bloqueo ? 'bloqueado' : 'disponible',
        reserva_id: reserva?.id ?? null,
        reserva_fija_id: reserva ? null : reservaFija?.id ?? null,
        bloqueo_id: reserva || reservaFija ? null : bloqueo?.id ?? null,
        precio_extra: precioExtra,
        precio_total: Math.round((precioBase + precioExtra) * 100) / 100,
      });
    }
  }

  return slots;
}

function disponibilidadCubreRango(
  fecha: string,
  horaInicio: string,
  horaFin: string,
  row: DisponibilidadSemanal,
): boolean {
  const dia = diaSemanaIso(fecha);
  const rowDia = Number(row.dia_semana);
  if (rowDia !== dia) return false;

  const requested = rangeToServiceDayMinutes(horaInicio, horaFin, row);
  const available = rangeToServiceDayMinutes(row.hora_inicio, row.hora_fin);
  return !!available && !!requested && available.start <= requested.start && available.end >= requested.end;
}

export function estaDisponible(opts: {
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  disponibilidad: DisponibilidadSemanal[];
  bloqueos: BloqueoTurno[];
  reservas: ReservaTurno[];
  reservasFijas?: ReservaFijaTurno[];
}): boolean {
  const cubierto = opts.disponibilidad.some(
    (d) => disponibilidadCubreRango(opts.fecha, opts.hora_inicio, opts.hora_fin, d),
  );
  if (!cubierto) return false;
  const requested = { fecha: opts.fecha, hora_inicio: opts.hora_inicio, hora_fin: opts.hora_fin };
  if (opts.bloqueos.some((b) => turnosOverlap(requested, b))) {
    return false;
  }
  return !opts.reservas.some(
    (r) =>
      r.estado !== 'cancelado' &&
      turnosOverlap(requested, r),
  ) && !reservasFijasParaFecha(opts.fecha, opts.reservasFijas).some((r) => turnosOverlap(requested, r));
}
