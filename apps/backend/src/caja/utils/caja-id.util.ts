/** Identificador TEXT legacy en caja_apertura / cierre_z / comprobante.caja_id. */
export function cajaUuidComoCajaIdText(cajaId: string): string {
  return cajaId.trim();
}

export function normalizarCaja(cajaId: string | null | undefined): string {
  const value = (cajaId || '').trim();
  return value || '__sin_caja__';
}

export function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fechaYmdArgentina(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date);
}
