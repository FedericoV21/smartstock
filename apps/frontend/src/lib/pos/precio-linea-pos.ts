import { redondearPrecioCentenasSuperior } from '@/lib/productos/calcular-precio-venta';
import {
  precioUnitarioConIvaPorCantidad,
  tramosConGananciaBaseOverride,
} from '@/lib/productos/precio-por-tramos';
import type { GananciaTramo } from '@/lib/productos/precio-por-tramos';

/** Snapshot mínimo de producto POS para aplicar ganancia por tramos. */
export type ProductoPricingPos = {
  precio_venta: number;
  precio_costo?: number | null;
  porcentaje_ganancia?: number | null;
  descuento_costo_pct?: number | null;
  iva_porcentaje?: number | null;
  ganancia_tramos?: GananciaTramo[] | null | undefined;
  precio_sucursal_ganancia_aplicada?: boolean;
  precio_sucursal_manual?: boolean;
};

/**
 * Precio unitario (sin IVA desglosado en UI; igual que catálogo) en **unidad de stock base**
 * para la cantidad vendida según reglas de `precio-por-tramos`. Si no hay datos para recomputar,
 * devuelve `precio_venta` (opcionalmente con redondeo al centenario según preferencia del negocio).
 */
export function precioUnitarioBaseParaCantidadPos(
  p: ProductoPricingPos,
  cantidadEnUnidadBase: number,
  ivaDefault: number,
  redondearPreciosCentenas: boolean,
  rebajaGananciaPct?: number,
  redondearMenores100ADecenas?: boolean,
  aumentoGananciaPct?: number,
  tramoGananciaForzadoCantidadDesde?: number | string | null,
): number {
  const aplicar = (pu: number) =>
    redondearPreciosCentenas
      ? redondearPrecioCentenasSuperior(pu, { redondearMenores100ADecenas })
      : pu;

  const c = Number(cantidadEnUnidadBase);
  if (!Number.isFinite(c) || c <= 0) {
    return aplicar(p.precio_venta);
  }

  const rebajaRaw = Number(rebajaGananciaPct ?? 0);
  const rebajaNorm = Number.isFinite(rebajaRaw) && rebajaRaw > 0 ? rebajaRaw : 0;
  const aumentoRaw = Number(aumentoGananciaPct ?? 0);
  const aumentoNorm = Number.isFinite(aumentoRaw) && aumentoRaw > 0 ? aumentoRaw : 0;
  if (p.precio_sucursal_manual === true && rebajaNorm <= 0 && aumentoNorm <= 0) {
    return aplicar(p.precio_venta);
  }

  const costo = Number(p.precio_costo);
  if (aumentoNorm > 0 && (!Number.isFinite(costo) || costo <= 0)) {
    return aplicar(p.precio_venta);
  }
  const tramos = tramosConGananciaBaseOverride(
    p.ganancia_tramos,
    p.porcentaje_ganancia,
    p.precio_sucursal_ganancia_aplicada === true,
  );
  const pctBaseKnown = p.porcentaje_ganancia != null && Number.isFinite(Number(p.porcentaje_ganancia));
  const puedeInferirGanancia =
    aumentoNorm > 0 &&
    Number.isFinite(costo) &&
    costo > 0 &&
    Number.isFinite(Number(p.precio_venta)) &&
    Number(p.precio_venta) > 0;
  const costoOk = Number.isFinite(costo) && (rebajaNorm > 0 ? costo > 0 : costo >= 0);
  const canCompute = costoOk && (tramos.length > 0 || pctBaseKnown || puedeInferirGanancia);

  if (!canCompute) {
    return aplicar(p.precio_venta);
  }

  const { precio_unitario } = precioUnitarioConIvaPorCantidad({
    precio_costo: costo,
    precio_venta_base: p.precio_venta,
    porcentaje_ganancia_base: p.porcentaje_ganancia,
    descuento_costo_pct: p.descuento_costo_pct,
    iva_porcentaje: p.iva_porcentaje,
    iva_default: ivaDefault,
    cantidad: c,
    tramos,
    redondearPreciosCentenas,
    redondearMenores100ADecenas,
    tramo_forzado_cantidad_desde: tramoGananciaForzadoCantidadDesde,
    ...(aumentoNorm > 0 ? { aumento_ganancia_pct: aumentoNorm } : {}),
    ...(rebajaNorm > 0 ? { rebaja_ganancia_pct: rebajaNorm } : {}),
  });
  return precio_unitario;
}
