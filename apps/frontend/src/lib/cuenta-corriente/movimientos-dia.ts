import { marcarEditableLiquidacionDia } from '@/lib/cuenta-corriente/liquidar-items-dia';
import {
  formatearNumeroComprobante,
  formatearTipoComprobante,
} from '@/lib/facturacion/formato';
import { formatCurrency, hoyEnAR, TIMEZONE_AR } from '@/lib/utils/formatters';

export const ESTADOS_COMPROBANTE_MOVIMIENTOS_DIA = ['emitido', 'pendiente_arca'] as const;

export type MovimientoDiaItemRow = {
  id: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  producto_variante_etiqueta: string | null;
  producto: {
    nombre: string;
    codigo: string | null;
    unidad: string | null;
    es_pesable: boolean | null;
  } | null;
};

export type MovimientoDiaComprobanteRow = {
  id: string;
  tipo: string;
  numero: number | null;
  numero_caja: number | null;
  fecha: string;
  created_at: string;
  total: number;
  cae?: string | null;
  comprobante_item: MovimientoDiaItemRow[] | null;
};

export type MovimientoDiaItemDto = {
  id: string;
  nombre: string;
  codigo: string | null;
  cantidad: number;
  cantidadLabel: string;
  precioUnitario: number;
  precioUnitarioLabel: string;
  subtotal: number;
  subtotalLabel: string;
};

export type MovimientoDiaComprobanteDto = {
  id: string;
  tipo: string;
  tipoLabel: string;
  numeroLabel: string;
  horaLabel: string;
  total: number;
  totalLabel: string;
  editable: boolean;
  items: MovimientoDiaItemDto[];
};

export type MovimientosDiaPayload = {
  fecha: string;
  sucursal_id: string;
  sucursal_nombre: string | null;
  liquidacion_habilitada: boolean;
  saldo_cuenta: number | null;
  saldo_cuenta_label: string;
  total_cargos_dia: number;
  total_cargos_dia_label: string;
  /** Saldo actual menos cargos CC del día (no resta cobros del mismo día). */
  saldo_sin_cargos_hoy: number | null;
  saldo_sin_cargos_hoy_label: string;
  comprobantes: MovimientoDiaComprobanteDto[];
};

function horaLabelArgentina(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TIMEZONE_AR,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function cantidadLabelItem(
  cantidad: number,
  producto: MovimientoDiaItemRow['producto'],
): string {
  if (producto?.es_pesable || producto?.unidad === 'gramo') {
    const g = Math.round(cantidad * 1000);
    return `${g} g`;
  }
  const n = cantidad;
  if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 0.0001) {
    return String(Math.round(n));
  }
  return n.toLocaleString('es-AR', { maximumFractionDigits: 3 });
}

function nombreItemLinea(row: MovimientoDiaItemRow): string {
  const base = row.producto?.nombre?.trim() || 'Ítem';
  const variante = row.producto_variante_etiqueta?.trim();
  return variante ? `${base} (${variante})` : base;
}

export function mapComprobantesAMovimientosDia(
  rows: MovimientoDiaComprobanteRow[],
  puntoDeVenta: number,
  opts?: { liquidacionHabilitada?: boolean },
): MovimientoDiaComprobanteDto[] {
  const liqOn = opts?.liquidacionHabilitada === true;
  return rows.map((c) => {
    const items = (c.comprobante_item ?? []).map((it) => ({
      id: it.id,
      nombre: nombreItemLinea(it),
      codigo: it.producto?.codigo ?? null,
      cantidad: it.cantidad,
      cantidadLabel: cantidadLabelItem(it.cantidad, it.producto),
      precioUnitario: it.precio_unitario,
      precioUnitarioLabel: formatCurrency(it.precio_unitario),
      subtotal: it.subtotal,
      subtotalLabel: formatCurrency(it.subtotal),
    }));

    const numeroLabel =
      c.tipo === 'ticket' && (c.numero == null || Number.isNaN(Number(c.numero))) && c.numero_caja != null
        ? `Ticket caja #${c.numero_caja}`
        : formatearNumeroComprobante(puntoDeVenta, c.numero);

    return {
      id: c.id,
      tipo: c.tipo,
      tipoLabel: formatearTipoComprobante(c.tipo),
      numeroLabel,
      horaLabel: horaLabelArgentina(c.created_at),
      total: c.total,
      totalLabel: formatCurrency(c.total),
      editable: liqOn && marcarEditableLiquidacionDia(c.tipo, c.cae),
      items,
    };
  });
}

export function buildMovimientosDiaPayload(opts: {
  sucursalId: string;
  sucursalNombre: string | null;
  saldoCuenta: number | null;
  comprobantes: MovimientoDiaComprobanteRow[];
  puntoDeVenta: number;
  fecha?: string;
  liquidacionHabilitada?: boolean;
}): MovimientosDiaPayload {
  const fecha = opts.fecha ?? hoyEnAR();
  const mapped = mapComprobantesAMovimientosDia(opts.comprobantes, opts.puntoDeVenta, {
    liquidacionHabilitada: opts.liquidacionHabilitada,
  });
  const totalCargos = mapped.reduce((s, c) => s + c.total, 0);
  const saldo = opts.saldoCuenta;
  const saldoSinCargos =
    saldo != null && Number.isFinite(saldo) ? Math.round((saldo - totalCargos) * 100) / 100 : null;

  return {
    fecha,
    sucursal_id: opts.sucursalId,
    sucursal_nombre: opts.sucursalNombre,
    liquidacion_habilitada: opts.liquidacionHabilitada === true,
    saldo_cuenta: saldo,
    saldo_cuenta_label: saldo != null ? formatCurrency(saldo) : '—',
    total_cargos_dia: totalCargos,
    total_cargos_dia_label: formatCurrency(totalCargos),
    saldo_sin_cargos_hoy: saldoSinCargos,
    saldo_sin_cargos_hoy_label:
      saldoSinCargos != null ? formatCurrency(saldoSinCargos) : '—',
    comprobantes: mapped,
  };
}

/** Cuenta comprobantes CC del día por cliente (para badge en listado). */
export function contarCargosHoyPorCliente(
  rows: { cliente_id: string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const id = r.cliente_id;
    if (!id) continue;
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}
