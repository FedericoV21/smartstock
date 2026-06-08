/**
 * Logs de diagnóstico en el servidor Next (terminal de `pnpm dev`).
 * - Por defecto: solo con NODE_ENV=development.
 * - Forzar en otro entorno: DEBUG_CAJA=1 en .env.local
 */
export function cajaServerDebug(label: string, data: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV !== 'development' && process.env.DEBUG_CAJA !== '1') return;
  console.info(`[caja-debug] ${label}`, data);
}
