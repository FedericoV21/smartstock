import { TIMEZONE_AR, fechaYmdArgentina, sumarDiasYmdAR } from '@/lib/utils/formatters';

export type PeriodoReporteKey = 'hoy' | 'semana' | 'mes' | 'rango';

export type PeriodoReporte = {
  key: PeriodoReporteKey;
  desde: string;
  hasta: string;
};

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const hourFormatterAr = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE_AR,
  hour: '2-digit',
  hourCycle: 'h23',
});

function assertYmd(fechaYmd: string): string {
  const t = fechaYmd.trim();
  if (!ISO_DATE_ONLY.test(t)) throw new Error(`fechaYmd invalida: ${fechaYmd}`);
  return t;
}

function weekdayArgentina(ymd: string): number {
  const [y, m, d] = assertYmd(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function ymdArgentina(date = new Date()): string {
  return fechaYmdArgentina(date);
}

export function sumarDiasYmd(ymd: string, dias: number): string {
  return sumarDiasYmdAR(assertYmd(ymd), dias);
}

export function diasEntreYmd(desde: string, hasta: string): number {
  const d1 = assertYmd(desde).split('-').map(Number);
  const d2 = assertYmd(hasta).split('-').map(Number);
  const t1 = Date.UTC(d1[0], d1[1] - 1, d1[2], 12);
  const t2 = Date.UTC(d2[0], d2[1] - 1, d2[2], 12);
  return Math.floor((t2 - t1) / 86_400_000);
}

export function diasCalendarioInclusivos(desde: string, hasta: string): number {
  return Math.max(1, diasEntreYmd(desde, hasta) + 1);
}

export function inicioDiaArgentinaIsoUtc(fechaYmd: string): string {
  const t = assertYmd(fechaYmd);
  const inst = new Date(`${t}T00:00:00.000-03:00`);
  if (!Number.isFinite(inst.getTime())) throw new Error(`fecha fuera de rango: ${fechaYmd}`);
  return inst.toISOString();
}

export function finDiaArgentinaIsoUtc(fechaYmd: string): string {
  const t = assertYmd(fechaYmd);
  const inst = new Date(`${t}T23:59:59.999-03:00`);
  if (!Number.isFinite(inst.getTime())) throw new Error(`fecha fuera de rango: ${fechaYmd}`);
  return inst.toISOString();
}

export function horaArgentina(date: string | Date): number | null {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (!Number.isFinite(d.getTime())) return null;
  const hour = hourFormatterAr.formatToParts(d).find((p) => p.type === 'hour')?.value;
  const n = hour == null ? Number.NaN : Number(hour);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
}

export function fechaYmdDesdeApiArgentina(value: string | Date): string | null {
  if (typeof value === 'string' && ISO_DATE_ONLY.test(value.trim())) return value.trim();
  const d = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) return null;
  return ymdArgentina(d);
}

export function resolverPeriodoReporte(
  sp: URLSearchParams,
  opts: { defaultKey?: Exclude<PeriodoReporteKey, 'rango'> } = {},
): PeriodoReporte {
  const defaultKey = opts.defaultKey ?? 'mes';
  const hoy = ymdArgentina();
  const raw = (sp.get('periodo') || defaultKey).toLowerCase();

  if (raw === 'rango') {
    const desde = (sp.get('desde') || '').trim();
    const hasta = (sp.get('hasta') || '').trim();
    if (desde && hasta) return { key: 'rango', desde, hasta };
    if (desde) return { key: 'rango', desde, hasta: desde };
    if (hasta) return { key: 'rango', desde: hasta, hasta };
    return { key: 'hoy', desde: hoy, hasta: hoy };
  }

  if (raw === 'hoy') return { key: 'hoy', desde: hoy, hasta: hoy };

  if (raw === 'semana') {
    const dia = weekdayArgentina(hoy);
    const diffLunes = dia === 0 ? 6 : dia - 1;
    return { key: 'semana', desde: sumarDiasYmd(hoy, -diffLunes), hasta: hoy };
  }

  if (raw === 'mes' || defaultKey === 'mes') {
    return { key: 'mes', desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  }

  return { key: 'hoy', desde: hoy, hasta: hoy };
}

export function resolverPeriodoReporteConLabel(
  sp: URLSearchParams,
  opts: { defaultKey?: Exclude<PeriodoReporteKey, 'rango'> } = {},
): { desde: string; hasta: string; periodo: PeriodoReporteKey; label: string } {
  const periodo = resolverPeriodoReporte(sp, opts);
  const label =
    periodo.key === 'rango'
      ? 'Rango personalizado'
      : periodo.key === 'semana'
        ? 'Semana actual'
        : periodo.key === 'mes'
          ? 'Mes actual'
          : 'Hoy';
  return { desde: periodo.desde, hasta: periodo.hasta, periodo: periodo.key, label };
}
