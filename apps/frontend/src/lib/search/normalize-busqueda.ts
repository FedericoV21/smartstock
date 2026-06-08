/**
 * Alinea el término de búsqueda con `texto_buscable` (lower + unaccent en BD).
 * Así "cafe" y "café" coinciden; también sirve para códigos numéricos sin acentos.
 */
export function normalizarTextoBusqueda(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}
