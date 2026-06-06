export const PLU_DIGITOS = 5;

/** Quita no-d├¡gitos, toma hasta 5, rellena con ceros a la izquierda. Vac├¡o ÔåÆ null. */
export function normalizarPlu5(raw: unknown): string | null {
  const d = String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, PLU_DIGITOS);
  if (!d) return null;
  return d.padStart(PLU_DIGITOS, '0');
}

/** PLU sin ceros a la izquierda (00023 ÔåÆ "23"). */
export function pluEnteroParaBusqueda(raw: unknown): string {
  const n5 = normalizarPlu5(raw);
  if (!n5) return '';
  const n = Number.parseInt(n5, 10);
  return Number.isFinite(n) ? String(n) : '';
}
