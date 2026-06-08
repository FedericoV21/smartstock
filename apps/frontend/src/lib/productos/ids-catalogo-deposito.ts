import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

const STOCK_SS_PAGE = 1000;

/**
 * IDs de `producto` con catálogo en el depósito (`producto.sucursal_id`) o con fila en
 * `stock_sucursal` para ese depósito — mismo criterio que `GET /api/productos` en sucursal actual.
 */
export async function idsProductosCatalogoOStockEnDeposito(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
): Promise<string[]> {
  const s = new Set<string>();
  /** Sin filtrar `activo`: el listado aplica `.eq('activo', …)` después. Si acá solo hubiera
   * activos, un producto dado de baja con hogar en este depósito quedaría fuera del set `ids` y
   * no aparecería ni activo ni inactivo cuando el depósito usa `in('id', ids)`. */
  const { data: homeRows, error: hErr } = await supabase
    .from('producto')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursalId);
  if (hErr) return [];
  for (const r of homeRows ?? []) s.add(r.id);

  let from = 0;
  for (;;) {
    const { data: ssRows, error: ssErr } = await supabase
      .from('stock_sucursal')
      .select('producto_id')
      .eq('tenant_id', tenantId)
      .eq('sucursal_id', sucursalId)
      .range(from, from + STOCK_SS_PAGE - 1);
    if (ssErr) break;
    const batch = ssRows ?? [];
    for (const row of batch) s.add(row.producto_id);
    if (batch.length < STOCK_SS_PAGE) break;
    from += STOCK_SS_PAGE;
  }
  return [...s];
}

const SS_IN_CHUNK = 500;

/**
 * Stock efectivo para validar venta en un depósito: `stock_sucursal` si hay fila; si no,
 * `producto.stock_actual` cuando el hogar del catálogo es ese depósito; si el hogar es otro
 * depósito y aún no hay fila en `stock_sucursal` acá, no se aplica techo (primera salida
 * materializa stock en esta sucursal, p. ej. negativo con `p_permitir_stock_negativo`).
 */
export async function mapStockEfectivoEnDeposito(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  depotId: string,
  productos: { id: string; sucursal_id: string; stock_actual: number }[],
): Promise<Map<string, number>> {
  const ssVals = new Map<string, number>();
  const ids = [...new Set(productos.map((p) => p.id))];
  for (let i = 0; i < ids.length; i += SS_IN_CHUNK) {
    const chunk = ids.slice(i, i + SS_IN_CHUNK);
    const { data, error } = await supabase
      .from('stock_sucursal')
      .select('producto_id, stock_actual')
      .eq('tenant_id', tenantId)
      .eq('sucursal_id', depotId)
      .in('producto_id', chunk);
    if (error) continue;
    for (const r of data ?? []) {
      ssVals.set(r.producto_id, Number(r.stock_actual));
    }
  }

  const out = new Map<string, number>();
  for (const p of productos) {
    if (ssVals.has(p.id)) {
      out.set(p.id, ssVals.get(p.id)!);
    } else if (p.sucursal_id === depotId) {
      out.set(p.id, Number(p.stock_actual));
    } else {
      // Sin fila en este depósito y catálogo hogar en otra sucursal: no usar 0 como techo
      // (bloquearía la primera venta). `registrar_movimiento` crea/actualiza `stock_sucursal` acá.
      out.set(p.id, Number.MAX_SAFE_INTEGER);
    }
  }
  return out;
}
