/**
 * Diagnóstico de ganancia por tramos.
 * - Terminal (Next dev): rutas `/api/productos/[id]/ganancia-tramos` (servidor).
 * - Consola del navegador: `PreciosCompraVentaPanel` al cargar/guardar.
 *
 * Activo con NODE_ENV=development o DEBUG_GANANCIA_TRAMOS=1 en .env.local
 */
export function debugGananciaTramos(where: string, data: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV !== 'development' && process.env.DEBUG_GANANCIA_TRAMOS !== '1') {
    return;
  }
  console.info(`[ganancia-tramos] ${where}`, data);
}
