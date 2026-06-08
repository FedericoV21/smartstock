/** Límite best-effort por instancia (Plan H: 10 extracciones / minuto / tenant). */
const buckets = new Map<string, { count: number; windowStart: number }>();

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

export function lectorFacturaExtraccionPermitida(tenantId: string): boolean {
  const now = Date.now();
  const b = buckets.get(tenantId);
  if (!b || now - b.windowStart >= WINDOW_MS) {
    buckets.set(tenantId, { count: 1, windowStart: now });
    return true;
  }
  if (b.count >= MAX_PER_WINDOW) return false;
  b.count += 1;
  return true;
}
