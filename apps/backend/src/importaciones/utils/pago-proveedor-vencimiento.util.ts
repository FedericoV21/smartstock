export type PagoProveedorEstadoUi = 'ya_pagada' | 'pendiente_condicion' | 'pendiente_fecha_custom';

export type CondicionPagoProveedorDb = 'contado' | 'dias' | 'fecha_fija';

export type ProveedorCondicionPago = {
  condicionPagoDefault: 'contado' | 'dias';
  plazoPagoDias: number | null;
};

function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error('Fecha inv├ílida');
  }
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function vencimientoTimestamptzDesdeDia(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error('Fecha de vencimiento inv├ílida');
  }
  return new Date(`${ymd}T12:00:00-03:00`);
}

export function proveedorTieneCondicionPagoCargada(p: ProveedorCondicionPago | null): boolean {
  if (!p) return false;
  if (p.condicionPagoDefault === 'contado') return true;
  return p.plazoPagoDias != null && p.plazoPagoDias > 0;
}

export function calcularVencimientoDia(input: {
  estado: PagoProveedorEstadoUi;
  fechaFacturaYmd: string;
  proveedor: ProveedorCondicionPago | null;
  vencimientoCustomYmd?: string | null;
  fechaPagoYmd?: string | null;
}): { vencimientoDiaYmd: string; condicion: CondicionPagoProveedorDb } {
  const f = input.fechaFacturaYmd.slice(0, 10);

  if (input.estado === 'ya_pagada') {
    const pago = (input.fechaPagoYmd ?? f).slice(0, 10);
    return { vencimientoDiaYmd: pago, condicion: 'contado' };
  }

  if (input.estado === 'pendiente_fecha_custom') {
    const v = input.vencimientoCustomYmd;
    if (v == null || v.length < 10) {
      throw new Error('Indic├í la fecha de vencimiento');
    }
    return { vencimientoDiaYmd: v.slice(0, 10), condicion: 'fecha_fija' };
  }

  const p = input.proveedor;
  if (!p) {
    throw new Error('Falta el proveedor para calcular el vencimiento');
  }
  if (p.condicionPagoDefault === 'contado') {
    return { vencimientoDiaYmd: f, condicion: 'contado' };
  }
  if (p.condicionPagoDefault === 'dias' && p.plazoPagoDias != null && p.plazoPagoDias > 0) {
    return {
      vencimientoDiaYmd: addCalendarDays(f, p.plazoPagoDias),
      condicion: 'dias',
    };
  }
  throw new Error('El proveedor no tiene plazo de pago configurado');
}

export function vencimientoDefaultPersonalizado(
  fechaFacturaYmd: string,
  fechaSugeridaIaYmd: string | null | undefined,
): string {
  if (fechaSugeridaIaYmd && /^\d{4}-\d{2}-\d{2}$/.test(fechaSugeridaIaYmd.slice(0, 10))) {
    return fechaSugeridaIaYmd.slice(0, 10);
  }
  return addCalendarDays(fechaFacturaYmd.slice(0, 10), 30);
}

export const TOLERANCIA_SALDO_CUENTA_CORRIENTE = 0.01;

export function calcularSaldoPendienteNuevoCargo(
  saldoDespuesCargo: number,
  montoCargo: number,
  tolerancia = TOLERANCIA_SALDO_CUENTA_CORRIENTE,
): number {
  if (!Number.isFinite(montoCargo) || montoCargo <= tolerancia) return 0;
  const saldoNormalizado = Number.isFinite(saldoDespuesCargo) ? saldoDespuesCargo : montoCargo;
  const pendiente = Math.min(montoCargo, Math.max(0, saldoNormalizado));
  return pendiente <= tolerancia ? 0 : Math.round(pendiente * 100) / 100;
}
