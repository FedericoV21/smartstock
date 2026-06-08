/**
 * Cálculo de vencimiento y condición al cargar facturas de compra a crédito (cuentas por pagar).
 */

export type PagoProveedorEstadoUi = 'ya_pagada' | 'pendiente_condicion' | 'pendiente_fecha_custom';

export type CondicionPagoProveedorDb = 'contado' | 'dias' | 'fecha_fija';

export type ProveedorCondicionPago = {
  condicion_pago_default: 'contado' | 'dias';
  plazo_pago_dias: number | null;
};

export type PagoProveedorInput = {
  estado: PagoProveedorEstadoUi;
  /** YYYY-MM-DD, requerido si ya_pagada */
  fecha_pago?: string;
  tipo_pago?: 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta' | 'otro';
  /** ISO fecha día (YYYY-MM-DD) para vencimiento si pendiente_fecha_custom */
  vencimiento_at?: string;
};

/** Día de vencimiento en calendario (YYYY-MM-DD). */
function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error('Fecha inválida');
  }
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Mediodía AR como ISO string para almacenar vencimiento_at (TIMESTAMPTZ). */
export function vencimientoTimestamptzDesdeDia(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error('Fecha de vencimiento inválida');
  }
  return new Date(`${ymd}T12:00:00-03:00`).toISOString();
}

/**
 * Puede usarse el modo “condición del proveedor” (contado o a días bien configurado).
 */
export function proveedorTieneCondicionPagoCargada(p: ProveedorCondicionPago | null): boolean {
  if (!p) return false;
  if (p.condicion_pago_default === 'contado') return true;
  return p.plazo_pago_dias != null && p.plazo_pago_dias > 0;
}

export function calcularVencimientoDia(
  input: {
    estado: PagoProveedorEstadoUi;
    fechaFacturaYmd: string;
    proveedor: ProveedorCondicionPago | null;
    vencimientoCustomYmd?: string | null;
    fechaPagoYmd?: string | null;
  },
): { vencimientoDiaYmd: string; condicion: CondicionPagoProveedorDb } {
  const f = input.fechaFacturaYmd.slice(0, 10);

  if (input.estado === 'ya_pagada') {
    const pago = (input.fechaPagoYmd ?? f).slice(0, 10);
    return { vencimientoDiaYmd: pago, condicion: 'contado' };
  }

  if (input.estado === 'pendiente_fecha_custom') {
    const v = input.vencimientoCustomYmd;
    if (v == null || v.length < 10) {
      throw new Error('Indicá la fecha de vencimiento');
    }
    return { vencimientoDiaYmd: v.slice(0, 10), condicion: 'fecha_fija' };
  }

  // pendiente_condicion
  const p = input.proveedor;
  if (!p) {
    throw new Error('Falta el proveedor para calcular el vencimiento');
  }
  if (p.condicion_pago_default === 'contado') {
    return { vencimientoDiaYmd: f, condicion: 'contado' };
  }
  if (p.condicion_pago_default === 'dias' && p.plazo_pago_dias != null && p.plazo_pago_dias > 0) {
    return {
      vencimientoDiaYmd: addCalendarDays(f, p.plazo_pago_dias),
      condicion: 'dias',
    };
  }
  throw new Error('El proveedor no tiene plazo de pago configurado');
}

/**
 * Primer día personalizado: extracción IA o 30 días calendario desde la factura.
 */
export function vencimientoDefaultPersonalizado(
  fechaFacturaYmd: string,
  fechaSugeridaIaYmd: string | null | undefined,
): string {
  if (fechaSugeridaIaYmd && /^\d{4}-\d{2}-\d{2}$/.test(fechaSugeridaIaYmd.slice(0, 10))) {
    return fechaSugeridaIaYmd.slice(0, 10);
  }
  return addCalendarDays(fechaFacturaYmd.slice(0, 10), 30);
}
