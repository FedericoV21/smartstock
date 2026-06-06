export function promoProductoKey(productoId: string): string {
  return productoId;
}

export function promoVarianteKey(productoId: string, varianteId: string | null | undefined): string {
  return varianteId ? `${productoId}::${varianteId}` : promoProductoKey(productoId);
}
