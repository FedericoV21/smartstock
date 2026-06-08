/** Utilidades para el reporte de sugerencia de compra / reposicion por proveedor. */

import {
  diasCalendarioInclusivos,
  resolverPeriodoReporte,
  sumarDiasYmd,
  ymdArgentina,
} from '@/lib/reportes/periodos';

export { diasCalendarioInclusivos, resolverPeriodoReporte };

export function ymdLocal(d: Date): string {
  return ymdArgentina(d);
}

export function addCalendarDays(ymd: string, deltaDays: number): string {
  return sumarDiasYmd(ymd, deltaDays);
}

export function redondearCantidadSugerida(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n * 1000) / 1000;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
