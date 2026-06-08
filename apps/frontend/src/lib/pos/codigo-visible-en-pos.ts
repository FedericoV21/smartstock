/** Producto o variante con los campos usados para mostrar codigo escaneable en POS. */
export type ProductoCodigoVisiblePos = {
  codigo?: string;
  codigo_barras?: string | null;
  plu?: string | null;
  variante?: { codigo_barras?: string | null } | null;
};

/**
 * Codigo a mostrar cuando esta activa la preferencia POS.
 * Prioridad: barras de variante > barras del producto > PLU > codigo interno.
 */
export function codigoVisibleEnPos(producto: ProductoCodigoVisiblePos): string | null {
  const fromVariante = producto.variante?.codigo_barras?.trim();
  if (fromVariante) return fromVariante;

  const barras = producto.codigo_barras?.trim();
  if (barras) return barras;

  const plu = producto.plu?.trim();
  if (plu) return plu;

  const codigo = producto.codigo?.trim();
  return codigo || null;
}
