import type { Importes } from '@/lib/facturacion/calcular-importes';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ajusta `precio_unitario` y `subtotal` de cada ítem para que la suma coincida con `importes.total`
 * (descuento/recargo por medio de pago, tributo 99, etc.). Así reportes por SKU y márgenes
 * reflejan lo cobrado, no solo el bruto de línea previo al medio.
 */
export function reconciliarItemsSubtotalesConTotal(importes: Importes): Importes {
  const target = round2(importes.total);
  const lineSum = round2(importes.items.reduce((s, i) => s + i.subtotal, 0));

  if (importes.items.length === 0 || lineSum <= 0 || Math.abs(lineSum - target) < 0.005) {
    return {
      ...importes,
      items: importes.items.map((i) => ({ ...i })),
    };
  }

  const factor = target / lineSum;
  const itemsAjustados = importes.items.map((item) => {
    const nuevoSub = round2(item.subtotal * factor);
    const cant = item.cantidad;
    const nuevoPu = cant > 0 ? round2(nuevoSub / cant) : item.precio_unitario;
    return {
      ...item,
      precio_unitario: nuevoPu,
      subtotal: nuevoSub,
    };
  });

  const sumAjust = round2(itemsAjustados.reduce((s, i) => s + i.subtotal, 0));
  const delta = round2(target - sumAjust);
  if (Math.abs(delta) >= 0.005 && itemsAjustados.length > 0) {
    const last = itemsAjustados[itemsAjustados.length - 1]!;
    last.subtotal = round2(last.subtotal + delta);
    if (last.cantidad > 0) {
      last.precio_unitario = round2(last.subtotal / last.cantidad);
    }
  }

  const esTicketSinIva =
    importes.iva_monto <= 0.005 && Math.abs(importes.subtotal - importes.total) < 0.01;

  return {
    ...importes,
    subtotal: esTicketSinIva ? target : importes.subtotal,
    iva_monto: esTicketSinIva ? 0 : importes.iva_monto,
    total: target,
    items: itemsAjustados,
  };
}

/** Factor para prorratear líneas históricas cuando `comprobante.total` ≠ Σ ítems. */
export function factorLineasVsTotalComprobante(totalComprobante: number, sumaSubtotalesLineas: number): number {
  const total = round2(totalComprobante);
  const suma = round2(sumaSubtotalesLineas);
  if (!Number.isFinite(total) || !Number.isFinite(suma) || suma <= 0) return 1;
  if (Math.abs(suma - total) < 0.005) return 1;
  return total / suma;
}
