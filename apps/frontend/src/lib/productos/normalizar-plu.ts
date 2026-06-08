/** Cantidad máxima de dígitos numéricos de un PLU en catálogo. */
export const PLU_DIGITOS = 5;

/**
 * Quita no-dígitos, toma hasta `PLU_DIGITOS`, rellena con ceros a la izquierda.
 * Ej: "123" → "00123". Vacío → null.
 */
export function normalizarPlu5(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '').slice(0, PLU_DIGITOS);
  if (!d) return null;
  return d.padStart(PLU_DIGITOS, '0');
}

/**
 * PLU como entero sin ceros a la izquierda (ej. 00023 → "23", 00005 → "5").
 * Sirve para que la búsqueda "23" encuentre PLU 00023.
 */
export function pluEnteroParaBusqueda(raw: unknown): string {
  const n5 = normalizarPlu5(raw);
  if (!n5) return '';
  const n = Number.parseInt(n5, 10);
  return Number.isFinite(n) ? String(n) : '';
}
