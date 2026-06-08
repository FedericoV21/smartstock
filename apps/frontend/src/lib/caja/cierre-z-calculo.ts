import { aplanarRepresentativosVentaPorOrden } from '@/lib/facturacion/ventas-representativas-por-orden';
import { fechaYmdArgentina } from '@/lib/utils/formatters';

export type ComprobanteCierreRow = {
  id: string;
  total: number;
  tipo: string;
  metodo_pago: string | null;
  metodo_pago_detalle: Record<string, unknown> | null;
  caja_id: string | null;
  numero_orden?: number | null;
};

export type TipoCierre = 'diario' | 'parcial';

export type ModoPeriodoCierre = 'jornada_fecha' | 'sesion_apertura';

export type SnapshotCierreZ = {
  total_comprobantes: number;
  ventas_brutas: number;
  notas_credito_total: number;
  ventas_netas: number;
  /**
   * Suma cobros cargados contra cuenta cliente en el período (otros medios y cobranzas vinculadas a facturas).
   * No incluye efectivo cargado sólo desde cuenta como “movimiento libre” (ése va a `efectivo_cobros_cc_manual`).
   */
  pagos_cta_cte_total: number;
  /** Efectivo ingresado por cobros manuales en cuenta corriente (sin comprobante asociado al pago): suma a la gaveta esperada. */
  efectivo_cobros_cc_manual: number;
  /** Fondo declarado al abrir (0 si no aplica). */
  fondo_apertura: number;
  /** Efectivo neto por ventas en el período (sin fondo). */
  efectivo_ventas_periodo: number;
  /** Efectivo esperado en gaveta antes de gastos: fondo + ventas en efectivo del período. */
  efectivo_esperado: number;
  modo_periodo: ModoPeriodoCierre;
  sesion_apertura_id: string | null;
  medios: {
    metodo_pago: string;
    monto_neto: number;
    cantidad_comprobantes: number;
  }[];
};

export function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function normalizarCaja(cajaId: string | null | undefined): string {
  const value = (cajaId || '').trim();
  return value || '__sin_caja__';
}

export function parseHoraToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutosToIsoUtc(fechaYmd: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return new Date(`${fechaYmd}T${hh}:${mm}:00.000-03:00`).toISOString();
}

/**
 * Fin del día calendario `fechaYmd` (23:59:59.999) en Argentina, como ISO UTC.
 * `minutosToIsoUtc(..., 23:59)` con sufijo Z es medianoche en UTC, no el fin del día en AR;
 * eso hacía que `opened_at` (p. ej. noche argentina) quedara “después” del tope del cierre.
 * Argentina (Buenos Aires) está en UTC−3 sin horario de verano desde 2009.
 */
export function finDiaOperativoArgentinaIsoUtc(fechaYmd: string): string {
  const t = fechaYmd.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) throw new Error(`fechaYmd inválida: ${fechaYmd}`);
  const inst = new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:59.999-03:00`);
  if (!Number.isFinite(inst.getTime())) throw new Error(`fecha fuera de rango: ${fechaYmd}`);
  return inst.toISOString();
}

export function esVenta(tipo: string): boolean {
  return tipo === 'ticket' || tipo.startsWith('factura_');
}

export function esNotaCredito(tipo: string): boolean {
  return tipo.startsWith('nota_credito_');
}

export function tipoIncluido(tipo: string): boolean {
  if (tipo === 'presupuesto' || tipo === 'remito' || tipo === 'devolucion_remito' || tipo === 'recibo') return false;
  return esVenta(tipo) || esNotaCredito(tipo);
}

function rangoFechasArgentina(desdeIso: string, hastaIso: string, fallback: string): { desde: string; hasta: string } {
  const desdeDate = new Date(desdeIso);
  const hastaDate = new Date(hastaIso);
  const desde = Number.isFinite(desdeDate.getTime()) ? fechaYmdArgentina(desdeDate) : fallback;
  const hasta = Number.isFinite(hastaDate.getTime()) ? fechaYmdArgentina(hastaDate) : desde;
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

/** Efectivo neto del comprobante (ventas suman, NC restan). Incluye desglose mixto. */
export function aporteEfectivoEnComprobante(c: ComprobanteCierreRow): number {
  const total = Number(c.total);
  if (!Number.isFinite(total)) return 0;
  const sign = esNotaCredito(c.tipo) ? -1 : 1;
  const mp = (c.metodo_pago || '').trim().toLowerCase();
  if (mp === 'efectivo') return sign * total;
  if (mp === 'mixto' && c.metodo_pago_detalle && typeof c.metodo_pago_detalle === 'object') {
    const raw = (c.metodo_pago_detalle as Record<string, unknown>).efectivo;
    const ef = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(ef)) return sign * ef;
  }
  return 0;
}

export async function calcularSnapshot(
  supabase: any,
  opts: {
    fechaOperativa: string;
    cajaIdNormalizada: string;
    sucursalId: string;
    rangoDesdeIso: string;
    rangoHastaIso: string;
    fondoApertura?: number;
    modoPeriodo?: ModoPeriodoCierre;
    sesionAperturaId?: string | null;
  },
): Promise<SnapshotCierreZ> {
  const usarRangoFechas = opts.modoPeriodo === 'sesion_apertura';
  const fechasPeriodo = rangoFechasArgentina(opts.rangoDesdeIso, opts.rangoHastaIso, opts.fechaOperativa);

  let query = supabase
    .from('comprobante')
    .select('id, total, tipo, metodo_pago, metodo_pago_detalle, caja_id, created_at, numero_orden')
    .eq('estado', 'emitido')
    .eq('sucursal_id', opts.sucursalId)
    .gte('created_at', opts.rangoDesdeIso)
    .lte('created_at', opts.rangoHastaIso);

  if (usarRangoFechas) {
    query = query.gte('fecha', fechasPeriodo.desde).lte('fecha', fechasPeriodo.hasta);
  } else {
    query = query.eq('fecha', opts.fechaOperativa);
  }

  if (opts.cajaIdNormalizada === '__sin_caja__') {
    query = query.is('caja_id', null);
  } else {
    query = query.eq('caja_id', opts.cajaIdNormalizada);
  }

  const { data: comprobantes, error: compErr } = await query;
  if (compErr) throw new Error(compErr.message);

  const incluidos = aplanarRepresentativosVentaPorOrden(
    (comprobantes ?? []).filter((c: ComprobanteCierreRow) => tipoIncluido(c.tipo)),
  ) as ComprobanteCierreRow[];

  let ventasBrutas = 0;
  let notasCreditoTotal = 0;
  let efectivoEsperado = 0;
  const medios = new Map<string, { monto_neto: number; cantidad: number }>();
  for (const c of incluidos) {
    const total = Number(c.total);
    const signed = esNotaCredito(c.tipo) ? -total : total;
    if (esVenta(c.tipo)) ventasBrutas += total;
    if (esNotaCredito(c.tipo)) notasCreditoTotal += total;

    efectivoEsperado += aporteEfectivoEnComprobante(c);

    const metodo = (c.metodo_pago || 'sin_definir').trim() || 'sin_definir';
    const prev = medios.get(metodo) ?? { monto_neto: 0, cantidad: 0 };
    prev.monto_neto += signed;
    prev.cantidad += 1;
    medios.set(metodo, prev);
  }

  let pagosQuery = supabase
    .from('pago')
    .select('monto, tipo_pago, cliente_id, proveedor_id, comprobante_id, created_at')
    .gte('created_at', opts.rangoDesdeIso)
    .lte('created_at', opts.rangoHastaIso);

  if (usarRangoFechas) {
    pagosQuery = pagosQuery.gte('fecha', fechasPeriodo.desde).lte('fecha', fechasPeriodo.hasta);
  } else {
    pagosQuery = pagosQuery.eq('fecha', opts.fechaOperativa);
  }

  const { data: pagosRows, error: pagosErr } = await pagosQuery;
  if (pagosErr) throw new Error(pagosErr.message);

  let efectivoCcManualPeriodo = 0;
  let pagosClienteInformativos = 0;
  for (const p of pagosRows ?? []) {
    const row = p as {
      monto: number;
      tipo_pago?: string | null;
      cliente_id?: string | null;
      proveedor_id?: string | null;
      comprobante_id?: string | null;
    };
    const monto = Number(row.monto);
    if (!Number.isFinite(monto)) continue;

    const esClienteSinProveedor = row.cliente_id != null && row.proveedor_id == null;

    /** Efectivo “en mano”: pagos cargados sólo desde CC (movimiento sin comprobante ligado). */
    const esEfectivoManualGaveta =
      esClienteSinProveedor &&
      row.comprobante_id == null &&
      String(row.tipo_pago ?? '').trim().toLowerCase() === 'efectivo';

    if (esEfectivoManualGaveta) {
      efectivoCcManualPeriodo += monto;
      continue;
    }

    /** Pagos cliente (incluye cobranza con comprobante, transferencias desde CC, pagos proveedor queda fuera). */
    if (esClienteSinProveedor) {
      pagosClienteInformativos += monto;
    }
    /* Movimientos a proveedor: no entrar al resumen CC cliente; el listado viejo los mezclaba y distorsionaba KPI. */
  }

  const pagosCtaCteTotal = redondear2(pagosClienteInformativos);

  const ventasNetas = redondear2(ventasBrutas - notasCreditoTotal);

  const fondo = redondear2(
    opts.fondoApertura !== undefined && opts.fondoApertura !== null && Number.isFinite(Number(opts.fondoApertura))
      ? Number(opts.fondoApertura)
      : 0,
  );
  const ventasEfectivo = redondear2(efectivoEsperado);
  const efectivoCcManualRounded = redondear2(efectivoCcManualPeriodo);
  const modo: ModoPeriodoCierre = opts.modoPeriodo ?? 'jornada_fecha';
  const sesionId = opts.sesionAperturaId ?? null;

  return {
    total_comprobantes: incluidos.length,
    ventas_brutas: redondear2(ventasBrutas),
    notas_credito_total: redondear2(notasCreditoTotal),
    ventas_netas: ventasNetas,
    pagos_cta_cte_total: pagosCtaCteTotal,
    efectivo_cobros_cc_manual: efectivoCcManualRounded,
    fondo_apertura: fondo,
    efectivo_ventas_periodo: ventasEfectivo,
    efectivo_esperado: redondear2(fondo + ventasEfectivo + efectivoCcManualRounded),
    modo_periodo: modo,
    sesion_apertura_id: sesionId,
    medios: Array.from(medios.entries())
      .map(([metodo_pago, row]) => ({
        metodo_pago,
        monto_neto: redondear2(row.monto_neto),
        cantidad_comprobantes: row.cantidad,
      }))
      .sort((a, b) => b.monto_neto - a.monto_neto),
  };
}

export function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}
