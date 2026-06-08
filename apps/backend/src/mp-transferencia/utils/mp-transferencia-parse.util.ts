import { hoyEnArgentina } from '../../facturacion/utils/fecha-argentina';

export function fechaMpTransferenciaHoy(): string {
  return hoyEnArgentina();
}

function addOneDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
  return date.toISOString().slice(0, 10);
}

export function rangoDiaArgentinaUtc(ymd: string): { beginDateIso: string; endDateIso: string } {
  return {
    beginDateIso: new Date(`${ymd}T00:00:00.000-03:00`).toISOString(),
    endDateIso: new Date(`${addOneDayYmd(ymd)}T00:00:00.000-03:00`).toISOString(),
  };
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t ? t : null;
}

export function parseMontoMp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  }
  const raw = stringOrNull(value);
  if (!raw) return null;
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function ymdArgentina(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function parseFechaMp(value: unknown): { ymd: string; iso: string | null } | null {
  const raw = stringOrNull(value);
  if (!raw) return null;

  const isoYmd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoYmd) {
    const d = new Date(raw);
    const hasTime = /[T\s]\d{1,2}:\d{2}/.test(raw);
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const ymd =
      !Number.isNaN(d.getTime()) && (hasTime || hasZone)
        ? ymdArgentina(d)
        : `${isoYmd[1]}-${isoYmd[2]}-${isoYmd[3]}`;
    return { ymd, iso: Number.isNaN(d.getTime()) ? null : d.toISOString() };
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return { ymd: ymdArgentina(d), iso: d.toISOString() };
}
