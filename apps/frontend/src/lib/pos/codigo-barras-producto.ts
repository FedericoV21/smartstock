/**
 * Reglas compartidas para `producto.codigo_barras`: EAN numérico o texto imprimible (Code 128 en etiquetas).
 */

export const CODIGO_BARRAS_PRODUCTO_MAX_LEN = 64;

/** 8–14 dígitos (EAN-8/13, UPC, ITF-14 sin validar dígito verificador). */
export function esCodigoBarrasNumericoExtendido(codigo: string): boolean {
  return /^\d{8,14}$/.test(codigo);
}

/** ASCII imprimible (32–126), longitud acotada para DB y Code 128 en etiquetas. */
export function esCodigoBarrasTextoImprimible(codigo: string): boolean {
  const t = codigo.trim();
  if (t.length < 1 || t.length > CODIGO_BARRAS_PRODUCTO_MAX_LEN) return false;
  return /^[\x20-\x7E]+$/.test(t);
}

export function esCodigoBarrasAsignable(codigo: string): boolean {
  const t = codigo.trim();
  return esCodigoBarrasNumericoExtendido(t) || esCodigoBarrasTextoImprimible(t);
}
