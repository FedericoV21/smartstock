/** Último día del mes (mes 0-indexed), calendario UTC (estable en servidor). */
function diasEnMesUtc(anio: number, mes: number) {
  return new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
}

function diaEfectivoEnMesUtc(anio: number, mes: number, diaDeseado: number) {
  return Math.min(diaDeseado, diasEnMesUtc(anio, mes));
}

function toYmdUtc(y: number, m: number, d: number) {
  const mm = String(m + 1).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

/**
 * Próxima fecha de corte (calendario UTC) >= hoy UTC, para un día de corte 1-28.
 */
export function proximoCorteMensualIso(dia: number, ahora = new Date()): string {
  const y0 = ahora.getUTCFullYear();
  const m0 = ahora.getUTCMonth();
  const d0 = ahora.getUTCDate();
  const hoyUtc = Date.UTC(y0, m0, d0);

  let y = y0;
  let m = m0;

  for (let i = 0; i < 24; i++) {
    const d = diaEfectivoEnMesUtc(y, m, dia);
    const candidato = Date.UTC(y, m, d);
    if (candidato >= hoyUtc) {
      return toYmdUtc(y, m, d);
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }

  const d = diaEfectivoEnMesUtc(y, m, dia);
  return toYmdUtc(y, m, d);
}
