import { diasEntreYmd, sumarDiasYmd, ymdArgentina } from './periodo-reporte.util';

export function addCalendarDays(ymd: string, deltaDays: number): string {
  return sumarDiasYmd(ymd, deltaDays);
}

export function redondearCantidadSugerida(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n * 1000) / 1000;
}

export function quiebreStock(stockActual: number, stockMinimo: number): boolean {
  return stockMinimo > 0 && stockActual <= stockMinimo;
}

export function diasHastaVencimiento(fechaVenc: string | null, hoyYmd?: string): number | null {
  if (!fechaVenc) return null;
  try {
    return diasEntreYmd(hoyYmd ?? ymdArgentina(), fechaVenc);
  } catch {
    return null;
  }
}

export function estadoVencimiento(dias: number | null): 'sin_fecha' | 'vencido' | 'critico' | 'proximo' | 'ok' {
  if (dias === null) return 'sin_fecha';
  if (dias < 0) return 'vencido';
  if (dias <= 7) return 'critico';
  if (dias <= 30) return 'proximo';
  return 'ok';
}
