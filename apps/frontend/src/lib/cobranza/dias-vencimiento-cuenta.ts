import type { Database } from '@/types/database';

type CuentaCobro = Pick<
  Database['public']['Tables']['cuenta_corriente']['Row'],
  | 'cobro_modalidad'
  | 'cobro_dias_plazo'
  | 'cobro_periodicidad'
  | 'cobro_dia_vencimiento_mes'
>;

function endOfLocalDayFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return new Date();
  }
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/** Próximo vencimiento: primer día `diaMes` del calendario en o después de la fecha de emisión (solo fecha). */
export function proximoVencimientoDiaFijoMes(emision: Date, diaMes: number): Date {
  const y = emision.getFullYear();
  const m = emision.getMonth();
  const d = emision.getDate();
  const lastDayOf = (yy: number, mm: number) => new Date(yy, mm + 1, 0).getDate();
  const clamp = (yy: number, mm: number, day: number) => Math.min(day, lastDayOf(yy, mm));
  const targetThisMonth = clamp(y, m, diaMes);
  if (d <= targetThisMonth) {
    return new Date(y, m, targetThisMonth, 23, 59, 59, 999);
  }
  let nm = m + 1;
  let ny = y;
  if (nm > 11) {
    nm = 0;
    ny += 1;
  }
  const targetNext = clamp(ny, nm, diaMes);
  return new Date(ny, nm, targetNext, 23, 59, 59, 999);
}

/** Días hasta vencimiento desde la fecha de emisión (modalidades por plazo o periódicas). */
export function diasHastaVencimientoDesdeCuenta(cuenta: CuentaCobro | null | undefined): number {
  if (!cuenta) return 7;
  if (cuenta.cobro_modalidad === 'dia_fijo_mes') {
    return 7;
  }
  if (cuenta.cobro_modalidad === 'periodico' && cuenta.cobro_periodicidad) {
    switch (cuenta.cobro_periodicidad) {
      case 'diaria':
        return 1;
      case 'semanal':
        return 7;
      case 'quincenal':
        return 15;
      case 'mensual':
        return 30;
      default:
        return 30;
    }
  }
  const d = cuenta.cobro_dias_plazo;
  if (typeof d === 'number' && d >= 1) return d;
  return 7;
}

/**
 * Fecha/hora de vencimiento para cobranza_factura.
 * `fechaExplicitaYmd`: YYYY-MM-DD del comprobante o del usuario; debe ser >= emisión (solo fecha).
 */
export function resolverVencimientoCobranza(params: {
  fechaEmisionYmd: string;
  fechaExplicitaYmd: string | null | undefined;
  cuenta: CuentaCobro | null | undefined;
}): Date {
  const { fechaEmisionYmd, fechaExplicitaYmd, cuenta } = params;
  const [ey, em, ed] = fechaEmisionYmd.split('-').map((x) => Number.parseInt(x, 10));
  const emision =
    Number.isFinite(ey) && Number.isFinite(em) && Number.isFinite(ed)
      ? new Date(ey, em - 1, ed, 12, 0, 0, 0)
      : new Date();

  if (fechaExplicitaYmd && /^\d{4}-\d{2}-\d{2}$/.test(fechaExplicitaYmd)) {
    return endOfLocalDayFromYmd(fechaExplicitaYmd);
  }

  if (cuenta?.cobro_modalidad === 'dia_fijo_mes' && cuenta.cobro_dia_vencimiento_mes) {
    return proximoVencimientoDiaFijoMes(emision, cuenta.cobro_dia_vencimiento_mes);
  }

  const dias = diasHastaVencimientoDesdeCuenta(cuenta);
  const v = new Date(emision);
  v.setDate(v.getDate() + dias);
  v.setHours(23, 59, 59, 999);
  return v;
}
