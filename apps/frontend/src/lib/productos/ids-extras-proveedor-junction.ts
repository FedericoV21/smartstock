import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

const PP_PAGE = 1000;
const PROD_CHUNK = 500;

/**
 * Productos que figuran en `producto_proveedor` para los proveedores dados pero cuya columna
 * `producto.proveedor_id` no coincide (null u otro proveedor). Deben sumarse con OR al filtro
 * por `proveedor_id.in.(...)`.
 *
 * Alcance:
 * - Vista una sucursal: solo `id` presentes en `idsVisiblesEnDeposito` (catálogo o stock ahí).
 * - Vista tenant / export: restricto a `sucursal_id` en `sucursalIdsCatalogo`.
 */
export async function idsProductoExtrasPorProveedorJunction(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  proveedorIds: string[],
  activo: boolean,
  sucursalIdsCatalogo: string[],
  idsVisiblesEnDeposito: string[] | null,
): Promise<string[]> {
  if (proveedorIds.length === 0 || sucursalIdsCatalogo.length === 0) {
    return [];
  }

  const setProv = new Set(proveedorIds);
  const desdeVinculos = new Set<string>();

  for (let from = 0; ; from += PP_PAGE) {
    const { data, error } = await supabase
      .from('producto_proveedor')
      .select('producto_id')
      .eq('tenant_id', tenantId)
      .in('proveedor_id', proveedorIds)
      .range(from, from + PP_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      if (r.producto_id) desdeVinculos.add(r.producto_id);
    }
    if (rows.length < PP_PAGE) break;
  }

  const candidatos = [...desdeVinculos];
  const out: string[] = [];

  for (let i = 0; i < candidatos.length; i += PROD_CHUNK) {
    const slice = candidatos.slice(i, i + PROD_CHUNK);
    const { data, error } = await supabase
      .from('producto')
      .select('id, proveedor_id, sucursal_id')
      .eq('tenant_id', tenantId)
      .eq('activo', activo)
      .in('id', slice);
    if (error) throw new Error(error.message);

    const visSet =
      idsVisiblesEnDeposito !== null ? new Set(idsVisiblesEnDeposito) : null;
    const catSet = new Set(sucursalIdsCatalogo);

    for (const p of data ?? []) {
      const pid = p.proveedor_id;
      if (pid != null && setProv.has(pid)) {
        continue;
      }
      if (visSet) {
        if (!visSet.has(p.id)) continue;
      } else if (!catSet.has(p.sucursal_id)) {
        continue;
      }
      out.push(p.id);
    }
  }

  return out;
}
