const TIMEZONE_AR = 'America/Argentina/Buenos_Aires';

function todayAr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_AR }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function resolverPeriodoExtracto(search: Record<string, string | undefined>): {
  desde: string;
  hasta: string;
  label: string;
} {
  const periodo = (search.periodo ?? 'mes').toLowerCase();
  const hoy = todayAr();

  if (periodo === 'hoy') {
    return { desde: hoy, hasta: hoy, label: 'Hoy' };
  }
  if (periodo === 'semana') {
    return { desde: addDays(hoy, -6), hasta: hoy, label: '├Ültimos 7 d├¡as' };
  }
  if (periodo === 'rango') {
    const desde = search.desde ?? hoy;
    const hasta = search.hasta ?? hoy;
    return { desde, hasta, label: `${desde} a ${hasta}` };
  }
  return { desde: startOfMonth(hoy), hasta: hoy, label: 'Mes en curso' };
}

export function hoyEnAR(): string {
  return todayAr();
}
