import { fechaYmdArgentina, redondear2 } from './caja-id.util';
import { aplanarRepresentativosVentaPorOrden } from './ventas-representativas-por-orden.util';

export type ComprobanteCierreRow = {
  id: string;
  total: number;
  tipo: string;
  metodo_pago: string | null;
  metodo_pago_detalle: Record<string, unknown> | null;
  caja_id: string | null;
  numero_orden?: number | null;
};

export type ModoPeriodoCierre = 'jornada_fecha' | 'sesion_apertura';

export type SnapshotCierreZ = {
  total_comprobantes: number;
  ventas_brutas: number;
  notas_credito_total: number;
  ventas_netas: number;
  pagos_cta_cte_total: number;
  efectivo_cobros_cc_manual: number;
  fondo_apertura: number;
  efectivo_ventas_periodo: number;
  efectivo_esperado: number;
  modo_periodo: ModoPeriodoCierre;
  sesion_apertura_id: string | null;
  medios: {
    metodo_pago: string;
    monto_neto: number;
    cantidad_comprobantes: number;
  }[];
};

export function esVenta(tipo: string): boolean {
  return tipo === 'ticket' || tipo.startsWith('factura_');
}

export function esNotaCredito(tipo: string): boolean {
  return tipo.startsWith('nota_credito_');
}

export function tipoIncluido(tipo: string): boolean {
  if (tipo === 'presupuesto' || tipo === 'remito' || tipo === 'devolucion_remito' || tipo === 'recibo') {
    return false;
  }
  return esVenta(tipo) || esNotaCredito(tipo);
}

function rangoFechasArgentina(
  desdeIso: string,
  hastaIso: string,
  fallback: string,
): { desde: string; hasta: string } {
  const desdeDate = new Date(desdeIso);
  const hastaDate = new Date(hastaIso);
  const desde = Number.isFinite(desdeDate.getTime()) ? fechaYmdArgentina(desdeDate) : fallback;
  const hasta = Number.isFinite(hastaDate.getTime()) ? fechaYmdArgentina(hastaDate) : desde;
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

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

export function calcularSnapshotDesdeComprobantes(
  comprobantes: ComprobanteCierreRow[],
  opts: {
    fechaOperativa: string;
    fondoApertura?: number;
    modoPeriodo?: ModoPeriodoCierre;
    sesionAperturaId?: string | null;
  },
): SnapshotCierreZ {
  const incluidos = aplanarRepresentativosVentaPorOrden(
    comprobantes.filter((c) => tipoIncluido(c.tipo)),
  );

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

  const fondo = redondear2(
    opts.fondoApertura !== undefined && opts.fondoApertura !== null && Number.isFinite(Number(opts.fondoApertura))
      ? Number(opts.fondoApertura)
      : 0,
  );
  const ventasEfectivo = redondear2(efectivoEsperado);
  const modo: ModoPeriodoCierre = opts.modoPeriodo ?? 'jornada_fecha';

  return {
    total_comprobantes: incluidos.length,
    ventas_brutas: redondear2(ventasBrutas),
    notas_credito_total: redondear2(notasCreditoTotal),
    ventas_netas: redondear2(ventasBrutas - notasCreditoTotal),
    pagos_cta_cte_total: 0,
    efectivo_cobros_cc_manual: 0,
    fondo_apertura: fondo,
    efectivo_ventas_periodo: ventasEfectivo,
    efectivo_esperado: redondear2(fondo + ventasEfectivo),
    modo_periodo: modo,
    sesion_apertura_id: opts.sesionAperturaId ?? null,
    medios: Array.from(medios.entries())
      .map(([metodo_pago, row]) => ({
        metodo_pago,
        monto_neto: redondear2(row.monto_neto),
        cantidad_comprobantes: row.cantidad,
      }))
      .sort((a, b) => b.monto_neto - a.monto_neto),
  };
}

export function rangoFechasParaSnapshot(
  rangoDesdeIso: string,
  rangoHastaIso: string,
  fechaOperativa: string,
): { desde: string; hasta: string } {
  return rangoFechasArgentina(rangoDesdeIso, rangoHastaIso, fechaOperativa);
}
