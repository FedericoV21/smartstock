/**
 * Logs de diagnóstico del filtrado en `GET /api/productos` (terminal de `pnpm dev` / logs del runtime).
 * - Por defecto: solo con NODE_ENV=development.
 * - Forzar en staging/prod o sin dev: DEBUG_PRODUCTOS_FILTRO=1 en .env.local
 */
export function productosFiltroDebug(label: string, data: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV !== 'development' && process.env.DEBUG_PRODUCTOS_FILTRO !== '1') return;
  console.info(`[productos-filtro] ${label}`, data);
}
