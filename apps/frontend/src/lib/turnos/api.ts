import { NextResponse } from 'next/server';

import {
  normalizarHora,
  rangeDurationMinutes,
  timeToMinutes,
  type DisponibilidadSemanal,
  type ExtraHorarioTurno,
} from '@/lib/turnos/slots';
import { parsearMontoInputUsuario } from '@/lib/ui/monto-argentino';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseObject(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export function strOrNull(value: unknown, max = 500): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

export function money(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : 0;
  }
  const n = parsearMontoInputUsuario(String(value ?? ''));
  return n !== null && n >= 0 ? n : 0;
}

export function parseDisponibilidad(raw: unknown):
  | { ok: true; rows: Omit<DisponibilidadSemanal, 'id'>[] }
  | { ok: false; response: NextResponse } {
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'disponibilidad debe ser un array' }, { status: 400 }),
    };
  }
  const rows: Omit<DisponibilidadSemanal, 'id'>[] = [];
  for (const item of raw) {
    const row = parseObject(item);
    const dia = Number(row.dia_semana);
    const ini = normalizarHora(String(row.hora_inicio ?? ''));
    const fin = normalizarHora(String(row.hora_fin ?? ''));
    if (!Number.isInteger(dia) || dia < 1 || dia > 7 || !ini || !fin) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Cada disponibilidad requiere dia_semana 1-7, hora_inicio y hora_fin HH:mm' },
          { status: 400 },
        ),
      };
    }
    if (rangeDurationMinutes(ini, fin) == null) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'hora_fin debe ser distinta a hora_inicio' },
          { status: 400 },
        ),
      };
    }
    rows.push({ dia_semana: dia, hora_inicio: ini, hora_fin: fin });
  }

  const minutosDia = 24 * 60;
  const minutosSemana = 7 * minutosDia;
  const rangos = rows.map((r) => {
    const inicio = (r.dia_semana - 1) * minutosDia + timeToMinutes(r.hora_inicio)!;
    const finBase = (r.dia_semana - 1) * minutosDia + timeToMinutes(r.hora_fin)!;
    return {
      inicio,
      fin: finBase > inicio ? finBase : finBase + minutosDia,
    };
  });
  const overlap = (a: { inicio: number; fin: number }, b: { inicio: number; fin: number }) =>
    a.inicio < b.fin && a.fin > b.inicio;
  for (let i = 0; i < rangos.length; i += 1) {
    for (let j = i + 1; j < rangos.length; j += 1) {
      const a = rangos[i];
      const b = rangos[j];
      if (
        overlap(a, b) ||
        overlap({ inicio: a.inicio - minutosSemana, fin: a.fin - minutosSemana }, b) ||
        overlap({ inicio: a.inicio + minutosSemana, fin: a.fin + minutosSemana }, b)
      ) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'Los rangos horarios de la agenda no pueden solaparse' },
            { status: 400 },
          ),
        };
      }
    }
  }

  return { ok: true, rows };
}

export function parseExtrasHorarios(raw: unknown):
  | { ok: true; rows: (Omit<ExtraHorarioTurno, 'id'> & { descripcion: string | null })[] }
  | { ok: false; response: NextResponse } {
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'extras_horarios debe ser un array' }, { status: 400 }),
    };
  }

  const rows: (Omit<ExtraHorarioTurno, 'id'> & { descripcion: string | null })[] = [];
  for (const item of raw) {
    const row = parseObject(item);
    const dia = Number(row.dia_semana);
    const ini = normalizarHora(String(row.hora_inicio ?? ''));
    const fin = normalizarHora(String(row.hora_fin ?? ''));
    const extraMonto = money(row.extra_monto);
    if (!Number.isInteger(dia) || dia < 1 || dia > 7 || !ini || !fin) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Cada extra requiere dia_semana 1-7, hora_inicio y hora_fin HH:mm' },
          { status: 400 },
        ),
      };
    }
    if (rangeDurationMinutes(ini, fin) == null) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'La hora fin del extra debe ser distinta a la hora inicio' },
          { status: 400 },
        ),
      };
    }
    if (extraMonto <= 0) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'El monto extra debe ser mayor a 0' },
          { status: 400 },
        ),
      };
    }
    rows.push({
      dia_semana: dia,
      hora_inicio: ini,
      hora_fin: fin,
      extra_monto: extraMonto,
      descripcion: strOrNull(row.descripcion, 200),
      activa: row.activa !== false,
    });
  }

  const minutosDia = 24 * 60;
  const minutosSemana = 7 * minutosDia;
  const rangos = rows.map((r) => {
    const inicio = (r.dia_semana - 1) * minutosDia + timeToMinutes(r.hora_inicio)!;
    const finBase = (r.dia_semana - 1) * minutosDia + timeToMinutes(r.hora_fin)!;
    return {
      inicio,
      fin: finBase > inicio ? finBase : finBase + minutosDia,
    };
  });
  const overlap = (a: { inicio: number; fin: number }, b: { inicio: number; fin: number }) =>
    a.inicio < b.fin && a.fin > b.inicio;
  for (let i = 0; i < rangos.length; i += 1) {
    for (let j = i + 1; j < rangos.length; j += 1) {
      const a = rangos[i];
      const b = rangos[j];
      if (
        overlap(a, b) ||
        overlap({ inicio: a.inicio - minutosSemana, fin: a.fin - minutosSemana }, b) ||
        overlap({ inicio: a.inicio + minutosSemana, fin: a.fin + minutosSemana }, b)
      ) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'Los extras horarios de la agenda no pueden solaparse' },
            { status: 400 },
          ),
        };
      }
    }
  }

  return { ok: true, rows };
}

export function parseFechaYmd(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function parseHoraReq(value: unknown): string | null {
  return normalizarHora(String(value ?? ''));
}
