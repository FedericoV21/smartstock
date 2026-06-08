import { precioUnitarioQueDaSubtotalLinea2Dec } from '@/lib/productos/calcular-precio-venta';
import { promoProductoKey, promoVarianteKey } from '@/lib/productos/variantes';
import type {
  ItemConPromo,
  ItemInputPromo,
  PromocionMotor,
  PromocionTipo,
  RangoVolumen,
} from '@/types/promociones';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Lunes = 1 … domingo = 7 (compatible con `dias_semana` en DB). */
export function diaSemanaDesdeLunes(fecha: Date): number {
  const d = fecha.getDay();
  return d === 0 ? 7 : d;
}

/** Fecha local YYYY-MM-DD (vigencia de promos es por día calendario). */
export function fechaLocalYmd(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const day = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function promocionVigente(promo: PromocionMotor, fecha: Date): boolean {
  if (!promo.activa) return false;

  const ymd = fechaLocalYmd(fecha);
  if (promo.vigente_desde != null && ymd < promo.vigente_desde) return false;
  if (promo.vigente_hasta != null && ymd > promo.vigente_hasta) return false;

  if (promo.dias_semana != null && promo.dias_semana.length > 0) {
    const dia = diaSemanaDesdeLunes(fecha);
    if (!promo.dias_semana.includes(dia)) return false;
  }

  return true;
}

const WEEKDAY_SHORT_LUN1_DOM7: Record<string, number> = {
  Sun: 7,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Día de la semana (lun=1…dom=7) para un YYYY-MM-DD en calendario Argentina/Buenos_Aires. */
export function diaSemanaDesdeLunesArgentina(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const inst = new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'short',
  })
    .format(inst)
    .replace(/\.$/, '');
  return WEEKDAY_SHORT_LUN1_DOM7[short] ?? 1;
}

/** Vigencia alineada con la fecha del comprobante (`hoyEnAR()` o `body.fecha` YYYY-MM-DD). */
export function promocionVigenteParaYmd(promo: PromocionMotor, fechaYmd: string): boolean {
  if (!promo.activa) return false;

  if (promo.vigente_desde != null && fechaYmd < promo.vigente_desde) return false;
  if (promo.vigente_hasta != null && fechaYmd > promo.vigente_hasta) return false;

  if (promo.dias_semana != null && promo.dias_semana.length > 0) {
    const dia = diaSemanaDesdeLunesArgentina(fechaYmd);
    if (!promo.dias_semana.includes(dia)) return false;
  }

  return true;
}

function subtotalLinea(cantidad: number, precioUnitario: number): number {
  return round2(cantidad * precioUnitario);
}

function aplicarPorcentajeSobrePrecioUnitario(
  precioUnitario: number,
  porcentaje: number,
): { precioEfectivo: number; descuentoPorUnidad: number } {
  const factor = 1 - porcentaje / 100;
  const precioEfectivo = round2(precioUnitario * factor);
  const descuentoPorUnidad = round2(precioUnitario - precioEfectivo);
  return { precioEfectivo, descuentoPorUnidad };
}

/** Porcentaje aplicable según cantidad en carrito (tramos o modo clásico). */
export function porcentajeDescuentoVolumen(promo: PromocionMotor, cantidad: number): number | null {
  const rangos = promo.rangos_volumen;
  if (rangos != null && rangos.length > 0) {
    return porcentajeParaRangoCantidad(cantidad, rangos);
  }
  const minQ = promo.cantidad_minima;
  const pct = promo.porcentaje;
  if (minQ == null || pct == null || cantidad < minQ) return null;
  return Number(pct);
}

function porcentajeParaRangoCantidad(cantidad: number, rangos: RangoVolumen[]): number | null {
  const Q = cantidad;
  for (const r of rangos) {
    const hasta = r.cantidad_hasta;
    if (Q >= r.cantidad_desde && (hasta == null || Q <= hasta)) {
      return r.porcentaje;
    }
  }
  return null;
}

function aplicarTipo(
  promo: PromocionMotor,
  item: ItemInputPromo,
): Omit<ItemConPromo, 'producto_id' | 'cantidad' | 'precio_unitario' | 'es_pesable'> | null {
  const { cantidad, precio_unitario, es_pesable } = item;
  const P = precio_unitario;
  const Q = cantidad;

  if (Q <= 0 || P < 0) return null;

  const tipo = promo.tipo as PromocionTipo;

  if (tipo === 'porcentaje_off') {
    const pct = promo.porcentaje;
    if (pct == null) return null;
    const { precioEfectivo } = aplicarPorcentajeSobrePrecioUnitario(P, Number(pct));
    const bruto = subtotalLinea(Q, P);
    const conPromo = subtotalLinea(Q, precioEfectivo);
    const descuento = round2(bruto - conPromo);
    if (descuento <= 0) return null;
    return {
      precio_unitario_original: P,
      precio_unitario_efectivo: precioEfectivo,
      promocion_id: promo.id,
      promocion_descripcion: promo.nombre,
      descuento_promo_monto: descuento,
    };
  }

  if (tipo === 'n_x_m') {
    if (es_pesable) return null;
    if (!Number.isInteger(Q)) return null;
    const N = promo.cantidad_lleva;
    const M = promo.cantidad_paga;
    if (N == null || M == null || N <= M || M <= 0) return null;

    const q = Math.floor(Q);
    const groups = Math.floor(q / N);
    const remainder = q - groups * N;
    const unidadesPago = groups * M + remainder;
    const totalPago = round2(unidadesPago * P);
    const bruto = subtotalLinea(q, P);
    const descuento = round2(bruto - totalPago);
    if (descuento <= 0) return null;
    const precioEfectivo = precioUnitarioQueDaSubtotalLinea2Dec(Q, totalPago);
    return {
      precio_unitario_original: P,
      precio_unitario_efectivo: precioEfectivo,
      promocion_id: promo.id,
      promocion_descripcion: promo.nombre,
      descuento_promo_monto: descuento,
    };
  }

  if (tipo === 'porcentaje_unidad_n') {
    if (es_pesable) return null;
    if (!Number.isInteger(Q)) return null;
    const u = promo.unidad_descuento;
    const pct = promo.porcentaje;
    if (u == null || u < 2 || pct == null) return null;

    const q = Math.floor(Q);
    /** Cada N-ésima unidad lleva el % (ej. N=2 → 2ª, 4ª, 6ª…), alineado a “2ª al 50%” en retail. */
    const discCount = Math.floor(q / u);
    const fullCount = q - discCount;
    const factor = 1 - Number(pct) / 100;
    const precioDesc = round2(P * factor);
    const totalPago = round2(fullCount * P + discCount * precioDesc);
    const bruto = subtotalLinea(q, P);
    const descuento = round2(bruto - totalPago);
    if (descuento <= 0) return null;
    const precioEfectivo = precioUnitarioQueDaSubtotalLinea2Dec(Q, totalPago);
    return {
      precio_unitario_original: P,
      precio_unitario_efectivo: precioEfectivo,
      promocion_id: promo.id,
      promocion_descripcion: promo.nombre,
      descuento_promo_monto: descuento,
    };
  }

  if (tipo === 'descuento_volumen') {
    const pct = porcentajeDescuentoVolumen(promo, Q);
    if (pct == null) return null;
    const { precioEfectivo } = aplicarPorcentajeSobrePrecioUnitario(P, Number(pct));
    const bruto = subtotalLinea(Q, P);
    const conPromo = subtotalLinea(Q, precioEfectivo);
    const descuento = round2(bruto - conPromo);
    if (descuento <= 0) return null;
    return {
      precio_unitario_original: P,
      precio_unitario_efectivo: precioEfectivo,
      promocion_id: promo.id,
      promocion_descripcion: promo.nombre,
      descuento_promo_monto: descuento,
    };
  }

  return null;
}

function sinPromo(item: ItemInputPromo): ItemConPromo {
  return {
    ...item,
    precio_unitario_original: null,
    precio_unitario_efectivo: item.precio_unitario,
    promocion_id: null,
    promocion_descripcion: null,
    descuento_promo_monto: null,
  };
}

function calcularBundlesCombo(
  indices: number[],
  items: ItemInputPromo[],
  req: Map<string, number>,
): number {
  const qty = new Map<string, number>();
  for (const [pid] of req) qty.set(pid, 0);
  for (const i of indices) {
    const it = items[i];
    const key = promoVarianteKey(it.producto_id, it.producto_variante_id);
    const fallbackKey = promoProductoKey(it.producto_id);
    const reqKey = req.has(key) ? key : fallbackKey;
    if (!req.has(reqKey)) continue;
    qty.set(reqKey, (qty.get(reqKey) ?? 0) + it.cantidad);
  }
  let minB = Infinity;
  for (const [pid, r] of req) {
    if (r <= 0) return 0;
    const q = qty.get(pid) ?? 0;
    minB = Math.min(minB, Math.floor(q / r));
  }
  return Number.isFinite(minB) ? minB : 0;
}

function aplicarComboPrecioFijo(
  result: ItemConPromo[],
  originalItems: ItemInputPromo[],
  promosPorProducto: Map<string, PromocionMotor | null | undefined>,
  fechaEmisionYmd: string,
  promoId: string,
): void {
  const motor = [...promosPorProducto.values()].find((p) => p?.id === promoId);
  if (
    !motor ||
    motor.tipo !== 'combo_precio_fijo' ||
    !motor.combo_items?.length ||
    motor.precio_combo == null
  ) {
    return;
  }
  if (!promocionVigenteParaYmd(motor, fechaEmisionYmd)) return;

  const indices: number[] = [];
  for (let i = 0; i < originalItems.length; i++) {
    const p =
      promosPorProducto.get(promoVarianteKey(originalItems[i].producto_id, originalItems[i].producto_variante_id)) ??
      promosPorProducto.get(promoProductoKey(originalItems[i].producto_id));
    if (p?.id === promoId && p.tipo === 'combo_precio_fijo') {
      indices.push(i);
    }
  }
  if (indices.length === 0) return;

  const req = new Map(
    motor.combo_items.map((x) => [promoVarianteKey(x.producto_id, x.producto_variante_id), x.cantidad]),
  );
  const bundles = calcularBundlesCombo(indices, originalItems, req);
  if (bundles < 1) return;

  const remaining = new Map<string, number>();
  for (const [pid, r] of req) remaining.set(pid, bundles * r);

  const takeByIdx = new Map<number, number>();
  for (const i of indices) {
    const it = originalItems[i];
    const key = promoVarianteKey(it.producto_id, it.producto_variante_id);
    const fallbackKey = promoProductoKey(it.producto_id);
    const pid = remaining.has(key) ? key : fallbackKey;
    const need = remaining.get(pid);
    if (!need || need <= 0) continue;
    if (!req.has(pid)) continue;
    const take = Math.min(it.cantidad, need);
    remaining.set(pid, need - take);
    takeByIdx.set(i, (takeByIdx.get(i) ?? 0) + take);
  }

  let totalBundled = 0;
  for (const i of indices) {
    const take = takeByIdx.get(i) ?? 0;
    if (take <= 0) continue;
    totalBundled += take * originalItems[i].precio_unitario;
  }

  if (totalBundled <= 0) return;

  const precioCombo = Number(motor.precio_combo);
  const discountTotal = round2(totalBundled - bundles * precioCombo);
  if (discountTotal <= 0.005) return;

  for (const i of indices) {
    const take = takeByIdx.get(i) ?? 0;
    const it = originalItems[i];
    const q = it.cantidad;
    const P = it.precio_unitario;
    const bundledVal = take * P;
    if (bundledVal <= 0) {
      result[i] = sinPromo(it);
      continue;
    }
    const descLine = round2((discountTotal * bundledVal) / totalBundled);
    const bruto = subtotalLinea(q, P);
    const lineNet = round2(bruto - descLine);
    const precioEfectivo = precioUnitarioQueDaSubtotalLinea2Dec(q, lineNet);
    result[i] = {
      ...it,
      precio_unitario_original: P,
      precio_unitario_efectivo: precioEfectivo,
      promocion_id: motor.id,
      promocion_descripcion: motor.nombre,
      descuento_promo_monto: descLine,
    };
  }
}

/**
 * Aplica promociones de catálogo sobre ítems del carrito. Sin I/O.
 * El mapa debe traer como mucho una promo por `producto_id` (garantizado por API en v1).
 * @param fechaEmisionYmd YYYY-MM-DD (misma convención que `hoyEnAR()` / fecha del comprobante).
 */
export function aplicarPromociones(
  items: ItemInputPromo[],
  promosPorProducto: Map<string, PromocionMotor | null | undefined>,
  fechaEmisionYmd: string,
): ItemConPromo[] {
  const first = items.map((item) => {
    const promo =
      promosPorProducto.get(promoVarianteKey(item.producto_id, item.producto_variante_id)) ??
      promosPorProducto.get(promoProductoKey(item.producto_id));
    if (!promo) {
      return sinPromo(item);
    }
    if (!promocionVigenteParaYmd(promo, fechaEmisionYmd)) {
      return sinPromo(item);
    }
    if (promo.tipo === 'combo_precio_fijo') {
      return sinPromo(item);
    }

    const aplicado = aplicarTipo(promo, item);
    if (!aplicado) {
      return sinPromo(item);
    }

    return {
      ...item,
      ...aplicado,
    };
  });

  const comboIds = new Set<string>();
  for (const promo of promosPorProducto.values()) {
    if (promo && promo.tipo === 'combo_precio_fijo') {
      comboIds.add(promo.id);
    }
  }

  const result = [...first];
  for (const promoId of comboIds) {
    aplicarComboPrecioFijo(result, items, promosPorProducto, fechaEmisionYmd, promoId);
  }

  return result;
}
