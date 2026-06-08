/**
 * Número interno estable para comprobantes importados (no usa la secuencia fiscal).
 * Mismo PV + número de documento ⇒ mismo entero (detección de duplicados).
 */
export function numeroComprobanteImportado(
  puntoVenta: number | null | undefined,
  numeroDocumento: number | null | undefined,
): number | null {
  if (puntoVenta == null || numeroDocumento == null) return null;
  const a = Math.max(0, Math.floor(puntoVenta ?? 0));
  const b = Math.max(0, Math.floor(numeroDocumento ?? 0));
  let x = (a + 0x7f4a7c15) ^ ((b + 0x9e3779b9) << 16);
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  const u = (x ^ (x >>> 16)) >>> 0;
  const n = u % 2_147_000_000;
  return n < 1_000 ? n + 1_000 : n;
}
