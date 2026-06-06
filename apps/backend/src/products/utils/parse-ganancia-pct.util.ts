import { GANANCIA_PCT_MAX } from './calcular-precio-venta';

export function parseGananciaPct(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > GANANCIA_PCT_MAX) return null;
  return Math.round(n * 100) / 100;
}
