import {
  calcularPrecioVenta,
  gananciaPorcentajeDesdeCostoYPvpConIva,
} from '@/lib/productos/calcular-precio-venta';

export type GananciaTramo = {
  cantidad_desde: number;
  ganancia_pct: number;
};

const GANANCIA_PCT_EPS = 1e-6;
const CANTIDAD_TRAMO_EPS = 1e-6;

/** True si hay más de un tramo o un único tramo con % distinto al porcentaje base del producto. */
export function tieneGananciaVariablePorCantidad(opts: {
  porcentaje_ganancia: number | null | undefined;
  ganancia_tramos: GananciaTramo[] | null | undefined;
}): boolean {
  const xs = normalizarTramos(opts.ganancia_tramos);
  if (xs.length >= 2) return true;
  if (xs.length === 0) return false;
  const base = Number(opts.porcentaje_ganancia ?? 0) || 0;
  const t = xs[0]!;
  return Math.abs(t.ganancia_pct - base) > GANANCIA_PCT_EPS;
}

export function normalizarTramos(tramos: GananciaTramo[] | null | undefined): GananciaTramo[] {
  const xs = (tramos ?? [])
    .map((t) => ({
      cantidad_desde: Number(t.cantidad_desde),
      ganancia_pct: Number(t.ganancia_pct),
    }))
    .filter((t) => Number.isFinite(t.cantidad_desde) && t.cantidad_desde >= 1 && Number.isFinite(t.ganancia_pct) && t.ganancia_pct >= 0);

  // Dedup por cantidad_desde (último gana) y orden asc.
  const map = new Map<number, GananciaTramo>();
  for (const t of xs) map.set(t.cantidad_desde, t);
  return [...map.values()].sort((a, b) => a.cantidad_desde - b.cantidad_desde);
}

export function tramosConGananciaBaseOverride(
  tramos: GananciaTramo[] | null | undefined,
  porcentajeGananciaBase: number | null | undefined,
  aplicarOverride: boolean,
): GananciaTramo[] {
  const xs = normalizarTramos(tramos);
  if (!aplicarOverride) return xs;

  const g = Number(porcentajeGananciaBase);
  if (!Number.isFinite(g) || g < 0) return xs;

  return xs.map((t) =>
    t.cantidad_desde === 1 ? { ...t, ganancia_pct: g } : t,
  );
}

export function normalizarCantidadTramoForzado(
  cantidadDesde: number | string | null | undefined,
): number | null {
  const n = Number(cantidadDesde);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function resolverCantidadParaPrecioPorTramo(opts: {
  cantidad: number;
  tramos: GananciaTramo[] | null | undefined;
  tramo_forzado_cantidad_desde?: number | string | null;
}): number {
  const cantidad = Number(opts.cantidad);
  const forzada = normalizarCantidadTramoForzado(opts.tramo_forzado_cantidad_desde);
  if (forzada == null) return cantidad;

  const xs = normalizarTramos(opts.tramos);
  const existe = xs.some((t) => Math.abs(t.cantidad_desde - forzada) <= CANTIDAD_TRAMO_EPS);
  return existe ? forzada : cantidad;
}

/**
 * Regla: el tramo vigente es el de mayor `cantidad_desde` tal que `cantidad_desde <= cantidad`.
 * Si no hay tramos aplicables, devuelve `null`.
 */
export function resolverGananciaPctPorCantidad(
  cantidad: number,
  tramos: GananciaTramo[] | null | undefined,
): number | null {
  const c = Number(cantidad);
  if (!Number.isFinite(c) || c <= 0) return null;
  const xs = normalizarTramos(tramos);
  if (xs.length === 0) return null;

  let best: GananciaTramo | null = null;
  for (const t of xs) {
    if (t.cantidad_desde <= c) {
      best = t;
    } else {
      break;
    }
  }
  return best ? best.ganancia_pct : null;
}

export function precioUnitarioConIvaPorCantidad(opts: {
  precio_costo: number | null | undefined;
  precio_venta_base?: number | null | undefined;
  porcentaje_ganancia_base: number | null | undefined;
  descuento_costo_pct?: number | null;
  iva_porcentaje: number | null | undefined;
  iva_default: number;
  cantidad: number;
  tramos?: GananciaTramo[] | null;
  redondearPreciosCentenas?: boolean;
  redondearMenores100ADecenas?: boolean;
  /** Puntos % sumados a la ganancia efectiva (post tramo), solo valores > 0 aplican. */
  aumento_ganancia_pct?: number | null;
  /** Puntos % restados a la ganancia efectiva (post tramo); solo valores > 0 aplican. */
  rebaja_ganancia_pct?: number | null;
  /** Si coincide con un tramo existente, usa ese umbral para elegir el precio sin cambiar la cantidad vendida. */
  tramo_forzado_cantidad_desde?: number | string | null;
}): {
  precio_unitario: number;
  ganancia_pct_usada: number;
  ganancia_pct_ajustada: number;
} {
  const cantidadParaPrecio = resolverCantidadParaPrecioPorTramo({
    cantidad: opts.cantidad,
    tramos: opts.tramos,
    tramo_forzado_cantidad_desde: opts.tramo_forzado_cantidad_desde,
  });
  const gTramo = resolverGananciaPctPorCantidad(cantidadParaPrecio, opts.tramos);
  const pctBaseRaw = Number(opts.porcentaje_ganancia_base);
  const pctBaseKnown = opts.porcentaje_ganancia_base != null && Number.isFinite(pctBaseRaw);
  const gananciaInferida =
    !pctBaseKnown && gTramo == null
      ? gananciaPorcentajeDesdeCostoYPvpConIva(
          Number(opts.precio_costo),
          Number(opts.precio_venta_base),
          opts.iva_porcentaje,
          opts.iva_default,
          { descuentoCostoPct: opts.descuento_costo_pct },
        )
      : 0;
  const gananciaUsada = gTramo != null ? gTramo : pctBaseKnown ? pctBaseRaw : gananciaInferida;
  const aumentoRaw = Number(opts.aumento_ganancia_pct ?? 0);
  const aumento = Number.isFinite(aumentoRaw) && aumentoRaw > 0 ? aumentoRaw : 0;
  const rebajaRaw = Number(opts.rebaja_ganancia_pct ?? 0);
  const rebaja = Number.isFinite(rebajaRaw) && rebajaRaw > 0 ? rebajaRaw : 0;
  const gananciaAjustada = gananciaUsada + aumento - rebaja;
  const pu = calcularPrecioVenta(opts.precio_costo, gananciaAjustada, opts.iva_porcentaje, opts.iva_default, {
    redondearPreciosCentenas: opts.redondearPreciosCentenas,
    redondearMenores100ADecenas: opts.redondearMenores100ADecenas,
    descuentoCostoPct: opts.descuento_costo_pct,
  });
  return { precio_unitario: pu, ganancia_pct_usada: gananciaUsada, ganancia_pct_ajustada: gananciaAjustada };
}
