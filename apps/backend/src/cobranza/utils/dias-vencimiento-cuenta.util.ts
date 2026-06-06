import { CobroModalidad } from '../../cuenta-corriente/enums/cobro-modalidad.enum';
import { CobroPeriodicidad } from '../../cuenta-corriente/enums/cobro-periodicidad.enum';

export type CuentaCobroResolver = {
  cobroModalidad: CobroModalidad;
  cobroPeriodicidad: CobroPeriodicidad | null;
  cobroDiasPlazo: number;
  cobroDiaVencimientoMes: number | null;
} | null;

function endOfLocalDayFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return new Date();
  }
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

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

export function diasHastaVencimientoDesdeCuenta(cuenta: CuentaCobroResolver): number {
  if (!cuenta) return 7;
  if (cuenta.cobroModalidad === CobroModalidad.dia_fijo_mes) {
    return 7;
  }
  if (cuenta.cobroModalidad === CobroModalidad.periodico && cuenta.cobroPeriodicidad) {
    switch (cuenta.cobroPeriodicidad) {
      case CobroPeriodicidad.diaria:
        return 1;
      case CobroPeriodicidad.semanal:
        return 7;
      case CobroPeriodicidad.quincenal:
        return 15;
      case CobroPeriodicidad.mensual:
        return 30;
      default:
        return 30;
    }
  }
  const d = cuenta.cobroDiasPlazo;
  if (typeof d === 'number' && d >= 1) return d;
  return 7;
}

export function resolverVencimientoCobranza(params: {
  fechaEmisionYmd: string;
  fechaExplicitaYmd: string | null | undefined;
  cuenta: CuentaCobroResolver;
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

  if (
    cuenta?.cobroModalidad === CobroModalidad.dia_fijo_mes &&
    cuenta.cobroDiaVencimientoMes
  ) {
    return proximoVencimientoDiaFijoMes(emision, cuenta.cobroDiaVencimientoMes);
  }

  const dias = diasHastaVencimientoDesdeCuenta(cuenta);
  const v = new Date(emision);
  v.setDate(v.getDate() + dias);
  v.setHours(23, 59, 59, 999);
  return v;
}
