const TIMEZONE_AR = 'America/Argentina/Buenos_Aires';

const currencyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: TIMEZONE_AR,
});

const dateTimeFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE_AR,
});

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

export function formatDate(date: string | Date): string {
  if (typeof date === 'string' && ISO_DATE_ONLY.test(date)) {
    // Un string "YYYY-MM-DD" representa un día calendario; no lo rotemos por UTC.
    const [y, m, d] = date.split('-').map(Number);
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  return dateFormatter.format(d);
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return dateTimeFormatter.format(d);
}

/**
 * Fecha "de hoy" en la zona horaria argentina como YYYY-MM-DD.
 * Evita el bug clásico de `new Date().toISOString().split('T')[0]`, que está en UTC
 * y entre las 21:00 y 23:59 hs locales ya devuelve el día siguiente.
 */
export function hoyEnAR(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE_AR,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}
