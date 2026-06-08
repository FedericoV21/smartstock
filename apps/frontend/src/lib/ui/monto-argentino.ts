import { parsearPrecioArgentino } from '@/lib/normalizador/validar';

/**
 * Formato visual estilo AR para inputs de monto: miles con `.`, decimales con `,`.
 * El parsing robusto vive en `parsearPrecioArgentino` (normalizador).
 */

/**
 * Monto ingresado en formulario (pesos AR: miles con `.`, decimales con `,`).
 * Usar al guardar inputs libres; para edición con formato en vivo, preferir `MontoInput`.
 */
export function parsearMontoInputUsuario(valor: string | null | undefined): number | null {
  if (valor == null || String(valor).trim() === '') return null;
  const n = parsearPrecioArgentino(valor);
  if (n === null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** No redondea de más: usa el número ya normalizado (p. ej. tras `parsearPrecioArgentino`). */
export function formatearMontoArgentinoEditable(n: number, maxDecimales: number): string {
  if (!Number.isFinite(n)) return '';
  const neg = n < 0;
  const abs = Math.abs(n);
  const f = 10 ** maxDecimales;
  const rounded = Math.round(abs * f) / f;
  const [intPart, frac = ''] = rounded.toFixed(maxDecimales).split('.');
  const intFmt = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (maxDecimales <= 0) {
    return neg ? `-${intFmt}` : intFmt;
  }
  const fracTrim = frac.replace(/0+$/, '');
  const body = fracTrim ? `${intFmt},${fracTrim}` : intFmt;
  return neg ? `-${body}` : body;
}

/** Evita reformatear mientras el usuario terminó de escribir el separador decimal. */
export function debePostergarFormateoMonto(raw: string): boolean {
  return /[.,]$/.test(raw.trim());
}

/** Montos enteros (sin decimales): todos los separadores visuales son miles. */
export function parsearMontoEnteroEditable(valor: string): number | null {
  const trimmed = valor.trim();
  if (trimmed === '' || trimmed === '-') return null;
  const neg = trimmed.startsWith('-');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits === '') return null;
  const num = Number(digits);
  if (!Number.isFinite(num)) return null;
  return neg ? -num : num;
}
