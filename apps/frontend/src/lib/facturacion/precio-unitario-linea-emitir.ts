import {
  precioUnitarioConIvaPorCantidad,
  tramosConGananciaBaseOverride,
  type GananciaTramo,
} from '@/lib/productos/precio-por-tramos';

const REBAJA_GANANCIA_MAX = 500;

/** Rebaja en puntos de ganancia (≥ 0). Valores no finitos o ≤ 0 → 0. */
export function normalizarRebajaGananciaPct(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.min(REBAJA_GANANCIA_MAX, x);
}

export type ProductoMiniPrecioLinea = {
  precio_costo?: number | null;
  precio_venta?: number | null;
  porcentaje_ganancia?: number | null;
  descuento_costo_pct?: number | null;
  iva_porcentaje?: number | null;
  precio_sucursal_ganancia_aplicada?: boolean | null;
  precio_sucursal_manual?: boolean | null;
};

/**
 * Precio unitario (IVA incluido, catálogo) por línea antes de promos:
 * - Con rebaja de ganancia: siempre desde costo + ganancia (tramos) − rebaja.
 * - Sin rebaja: mismo criterio que antes — si el body difiere del PVP catálogo, se respeta como precio manual.
 */
export function precioUnitarioLineaEmitirConTramos(
  item: {
    cantidad: number;
    precio_unitario: number;
    rebaja_ganancia_pct?: number;
    tramo_ganancia_forzado_cantidad_desde?: number | string | null;
  },
  prod: ProductoMiniPrecioLinea,
  tramos: GananciaTramo[] | null | undefined,
  ivaFallback: number,
  redondearPreciosCentenas?: boolean,
  redondearMenores100ADecenas?: boolean,
  aumentoGananciaPct?: number,
): number {
  const rebaja = normalizarRebajaGananciaPct(item.rebaja_ganancia_pct);
  const aumentoRaw = Number(aumentoGananciaPct ?? 0);
  const aumento = Number.isFinite(aumentoRaw) && aumentoRaw > 0 ? aumentoRaw : 0;
  const tramosEfectivos = tramosConGananciaBaseOverride(
    tramos,
    prod.porcentaje_ganancia,
    prod.precio_sucursal_ganancia_aplicada === true,
  );
  const precioCatalogo = Number(prod.precio_venta);
  const precioBody = Number(item.precio_unitario);

  if (rebaja > 0 || aumento > 0) {
    const costo = Number(prod.precio_costo);
    if (!Number.isFinite(costo) || costo <= 0) {
      return Number.isFinite(precioCatalogo) ? precioCatalogo : item.precio_unitario;
    }
    const pctBaseKnown =
      prod.porcentaje_ganancia != null && Number.isFinite(Number(prod.porcentaje_ganancia));
    const puedeInferirGanancia =
      aumento > 0 &&
      Number.isFinite(precioCatalogo) &&
      precioCatalogo > 0;
    if (!pctBaseKnown && tramosEfectivos.length === 0 && !puedeInferirGanancia) {
      return Number.isFinite(precioCatalogo) ? precioCatalogo : item.precio_unitario;
    }
    const { precio_unitario } = precioUnitarioConIvaPorCantidad({
      precio_costo: prod.precio_costo,
      precio_venta_base: prod.precio_venta,
      porcentaje_ganancia_base: prod.porcentaje_ganancia,
      descuento_costo_pct: prod.descuento_costo_pct,
      iva_porcentaje: prod.iva_porcentaje,
      iva_default: ivaFallback,
      cantidad: item.cantidad,
      tramos: tramosEfectivos,
      redondearPreciosCentenas,
      redondearMenores100ADecenas,
      tramo_forzado_cantidad_desde: item.tramo_ganancia_forzado_cantidad_desde,
      aumento_ganancia_pct: aumento,
      rebaja_ganancia_pct: rebaja,
    });
    if (
      aumento > 0 &&
      rebaja <= 0 &&
      Number.isFinite(precioBody) &&
      Number.isFinite(precioCatalogo) &&
      Math.abs(precioBody - precioCatalogo) > 0.005 &&
      Math.abs(precioBody - precio_unitario) > 0.005
    ) {
      return precioBody;
    }
    return precio_unitario;
  }

  if (
    Number.isFinite(precioCatalogo) &&
    Number.isFinite(precioBody) &&
    Math.abs(precioBody - precioCatalogo) > 0.005
  ) {
    return precioBody;
  }
  if (prod.precio_sucursal_manual === true) {
    return Number.isFinite(precioCatalogo) ? precioCatalogo : item.precio_unitario;
  }

  const pctBaseKnown =
    prod.porcentaje_ganancia != null && Number.isFinite(Number(prod.porcentaje_ganancia));
  if (!pctBaseKnown && tramosEfectivos.length === 0) {
    return Number.isFinite(precioCatalogo) ? precioCatalogo : item.precio_unitario;
  }

  const { precio_unitario } = precioUnitarioConIvaPorCantidad({
    precio_costo: prod.precio_costo,
    porcentaje_ganancia_base: prod.porcentaje_ganancia,
    descuento_costo_pct: prod.descuento_costo_pct,
    iva_porcentaje: prod.iva_porcentaje,
    iva_default: ivaFallback,
    cantidad: item.cantidad,
    tramos: tramosEfectivos,
    redondearPreciosCentenas,
    redondearMenores100ADecenas,
    tramo_forzado_cantidad_desde: item.tramo_ganancia_forzado_cantidad_desde,
  });
  return precio_unitario;
}
