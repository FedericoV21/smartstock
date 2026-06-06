const WEIGHTS = [1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3] as const;

/** Prefijo fijo (3 d├¡gitos) para EAN-13 generados internamente (alineado al front). */
export const PREFIJO_EAN13_INTERNO = '135' as const;

export function calcularCheckDigitEAN13(digits12: string): string {
  if (digits12.length !== 12 || !/^\d{12}$/.test(digits12)) {
    throw new Error('Se requieren exactamente 12 d├¡gitos num├®ricos');
  }

  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits12[i]) * WEIGHTS[i];
  }

  const remainder = sum % 10;
  return remainder === 0 ? '0' : String(10 - remainder);
}

/**
 * Genera un EAN-13 interno: prefijo 135 + secuencial (9 d├¡gitos) + d├¡gito verificador.
 */
export function generarEAN13Interno(secuencial: number): string {
  if (secuencial < 1 || secuencial > 999_999_999 || !Number.isInteger(secuencial)) {
    throw new Error('El secuencial debe ser un entero entre 1 y 999999999');
  }

  const body = PREFIJO_EAN13_INTERNO + String(secuencial).padStart(9, '0');
  return body + calcularCheckDigitEAN13(body);
}

export function secuencialDesdeEAN13Interno(codigo: string): number | null {
  if (!codigo.startsWith(PREFIJO_EAN13_INTERNO) || codigo.length !== 13 || !/^\d{13}$/.test(codigo)) {
    return null;
  }
  const n = parseInt(codigo.substring(3, 12), 10);
  return Number.isFinite(n) ? n : null;
}

export function siguienteSecuencialInterno(maxCodigo: string | null | undefined): number {
  if (!maxCodigo) return 1;
  const current = secuencialDesdeEAN13Interno(maxCodigo);
  return current === null ? 1 : current + 1;
}
