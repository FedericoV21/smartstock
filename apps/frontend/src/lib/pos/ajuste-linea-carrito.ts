import {
  aplicarAjusteLineaPrecioUnitario,
  normalizarPorcentajeManual,
} from '@/lib/facturacion/ajuste-comercial';

export type AjusteLineaCarrito = {
  descuento_manual_pct?: number | null;
  recargo_manual_pct?: number | null;
};

export function descuentoManualItemNormalizado(item: AjusteLineaCarrito): number {
  return normalizarPorcentajeManual(item.descuento_manual_pct);
}

export function recargoManualItemNormalizado(item: AjusteLineaCarrito): number {
  return normalizarPorcentajeManual(item.recargo_manual_pct);
}

export function precioUnitarioConAjusteManualItem(
  precioUnitarioEfectivo: number,
  item: AjusteLineaCarrito,
): number {
  return aplicarAjusteLineaPrecioUnitario(
    precioUnitarioEfectivo,
    item.descuento_manual_pct,
    item.recargo_manual_pct,
  );
}

export function ajusteManualItemEnPayload(
  item: AjusteLineaCarrito,
): { descuento_manual_pct?: number; recargo_manual_pct?: number } {
  const descuento = descuentoManualItemNormalizado(item);
  const recargo = recargoManualItemNormalizado(item);
  return {
    ...(descuento > 0 ? { descuento_manual_pct: descuento } : {}),
    ...(recargo > 0 ? { recargo_manual_pct: recargo } : {}),
  };
}

export function textoAjusteManualItem(item: AjusteLineaCarrito): string | null {
  const descuento = descuentoManualItemNormalizado(item);
  if (descuento > 0) return `Desc. item -${descuento}%`;
  const recargo = recargoManualItemNormalizado(item);
  if (recargo > 0) return `Rec. item +${recargo}%`;
  return null;
}
