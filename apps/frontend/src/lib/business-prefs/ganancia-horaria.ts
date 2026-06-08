import {
  normalizeGananciaHorariaPrefs,
  type BusinessPrefs,
  type GananciaHorariaPrefs,
} from '@/lib/business-prefs/prefs';
import { TIMEZONE_AR } from '@/lib/utils/formatters';

export function minutosDesdeHHMM(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutosDelDiaArgentina(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE_AR,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export function gananciaHorariaEstaActiva(
  rawPrefs: GananciaHorariaPrefs | unknown,
  date: Date = new Date(),
): boolean {
  const prefs = normalizeGananciaHorariaPrefs(rawPrefs);
  if (!prefs.habilitado || prefs.aumentoPuntosPct <= 0) return false;

  const desde = minutosDesdeHHMM(prefs.horaDesde);
  const hasta = minutosDesdeHHMM(prefs.horaHasta);
  if (desde == null || hasta == null || desde === hasta) return false;

  const ahora = minutosDelDiaArgentina(date);
  if (desde < hasta) return ahora >= desde && ahora < hasta;
  return ahora >= desde || ahora < hasta;
}

export function aumentoGananciaHorariaActivo(
  prefs: BusinessPrefs | null | undefined,
  date: Date = new Date(),
): number {
  const gananciaHoraria = normalizeGananciaHorariaPrefs(prefs?.gananciaHoraria);
  return gananciaHorariaEstaActiva(gananciaHoraria, date)
    ? gananciaHoraria.aumentoPuntosPct
    : 0;
}
