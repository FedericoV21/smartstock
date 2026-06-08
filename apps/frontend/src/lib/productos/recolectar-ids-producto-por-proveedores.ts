import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { productosFiltroDebug } from '@/lib/productos/debug-productos-filtro';

const PAGE = 800;

/** Productos que tienen ese proveedor en `producto.proveedor_id` o en `producto_proveedor`. */
export async function recolectarIdsProductosPorProveedores(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalIdsFiltro: string[],
  proveedorIds: string[],
  /** Si es true, solo filas con `activo = false` (listado de dados de baja). */
  soloInactivos = false,
): Promise<string[]> {
  if (proveedorIds.length === 0 || sucursalIdsFiltro.length === 0) {
    productosFiltroDebug('recolectarIdsProductosPorProveedores omitido', {
      proveedorIds: proveedorIds.length,
      sucursalIds: sucursalIdsFiltro.length,
    });
    return [];
  }

  const out = new Set<string>();

  const activo = soloInactivos ? false : true;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('producto')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('activo', activo)
      .in('sucursal_id', sucursalIdsFiltro)
      .in('proveedor_id', proveedorIds)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      if (r.id) out.add(r.id);
    }
    if (rows.length < PAGE) break;
  }

  const idsPorColumnaPrincipal = out.size;

  const desdeVinculos = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('producto_proveedor')
      .select('producto_id')
      .eq('tenant_id', tenantId)
      .in('proveedor_id', proveedorIds)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      if (r.producto_id) desdeVinculos.add(r.producto_id);
    }
    if (rows.length < PAGE) break;
  }

  const idsDistintosEnJunction = desdeVinculos.size;

  const cand = [...desdeVinculos];
  for (let i = 0; i < cand.length; i += PAGE) {
    const slice = cand.slice(i, i + PAGE);
    const { data, error } = await supabase
      .from('producto')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('activo', activo)
      .in('sucursal_id', sucursalIdsFiltro)
      .in('id', slice);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      if (r.id) out.add(r.id);
    }
  }

  const idsFinales = [...out];
  productosFiltroDebug('recolectarIdsProductosPorProveedores', {
    proveedorIdsCount: proveedorIds.length,
    sucursalIdsCount: sucursalIdsFiltro.length,
    soloInactivos,
    idsPorProveedorPrincipal: idsPorColumnaPrincipal,
    idsDistintosProductoProveedor: idsDistintosEnJunction,
    idsFinalesTrasAlcance: idsFinales.length,
  });

  return idsFinales;
}
