import type { ItemConPromo } from '@/types/promociones';

/**
 * Precio unitario a enviar al emitir comprobante / borrador desde POS.
 * Debe ser el precio de lista (antes de promo), no `precio_unitario_efectivo`:
 * en servidor `precioUnitarioLineaEmitirConTramos` respeta un body distinto al catálogo
 * como override manual y `aplicarPromociones` volvería a descontar.
 */
export function precioUnitarioListaParaEmitirDesdePos(
  itemConPromo: ItemConPromo | undefined,
  precioVentaFallback: number,
): number {
  const lista = itemConPromo != null ? Number(itemConPromo.precio_unitario) : NaN;
  if (Number.isFinite(lista) && lista > 0) return lista;
  const fallback = Number(precioVentaFallback);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}
