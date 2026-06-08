import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

const CHUNK = 500;

/** Stock y mínimo en un depósito para un conjunto de productos (reportes / dashboard). */
export async function fetchStockSucursalPorProductosEnSucursal(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; sucursalId: string; productoIds: string[] },
): Promise<Map<string, { stock_actual: number; stock_minimo: number }>> {
  const out = new Map<string, { stock_actual: number; stock_minimo: number }>();
  const ids = [...new Set(args.productoIds.filter(Boolean))];
  if (ids.length === 0) return out;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('stock_sucursal')
      .select('producto_id, stock_actual, stock_minimo')
      .eq('tenant_id', args.tenantId)
      .eq('sucursal_id', args.sucursalId)
      .in('producto_id', chunk);

    if (error) continue;
    for (const r of data ?? []) {
      out.set(r.producto_id, {
        stock_actual: Number(r.stock_actual),
        stock_minimo: Number(r.stock_minimo),
      });
    }
  }
  return out;
}
