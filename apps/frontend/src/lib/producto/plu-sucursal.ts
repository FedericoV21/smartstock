import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizarPlu5 } from '@/lib/productos/normalizar-plu';
import type { Database } from '@/types/database';

export type PluSucursalRow = {
  sucursal_id: string;
  plu: string;
};

export function pluEfectivoProductoEnSucursal(
  productoPlu: string | null | undefined,
  overridePlu: string | null | undefined,
): string | null {
  if (overridePlu != null && String(overridePlu).trim() !== '') {
    return normalizarPlu5(overridePlu);
  }
  if (productoPlu != null && String(productoPlu).trim() !== '') {
    return normalizarPlu5(productoPlu);
  }
  return null;
}

export async function fetchPluSucursalPorProducto(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; productoId: string; sucursalIds?: string[] },
): Promise<PluSucursalRow[]> {
  let q = supabase
    .from('plu_sucursal')
    .select('sucursal_id, plu')
    .eq('tenant_id', args.tenantId)
    .eq('producto_id', args.productoId);
  if (args.sucursalIds?.length) {
    q = q.in('sucursal_id', args.sucursalIds);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => ({
    sucursal_id: r.sucursal_id,
    plu: r.plu,
  }));
}

type BuscarPluArgs = {
  tenantId: string;
  sucursalId: string;
  plu: string;
  select: string;
  proveedorId?: string | null;
  extraEq?: Record<string, string | boolean>;
  /** Si false, solo consulta `producto.plu` (comportamiento legacy). */
  permitirPluSucursal?: boolean;
};

/**
 * Busca productos activos cuyo PLU efectivo en la sucursal coincide con `plu`.
 * Prioriza overrides en `plu_sucursal`; si no hay override usa `producto.plu`.
 */
export async function buscarProductosPorPluEnSucursal(
  supabase: SupabaseClient<Database>,
  args: BuscarPluArgs,
): Promise<Record<string, unknown>[]> {
  const pluNorm = normalizarPlu5(args.plu) ?? args.plu;
  const permitirPluSucursal = args.permitirPluSucursal === true;

  let overrideIds: string[] = [];
  let excludedFromGlobal = new Set<string>();

  if (permitirPluSucursal) {
    const [{ data: overrideRows }, { data: allOverrideRows }] = await Promise.all([
      supabase
        .from('plu_sucursal')
        .select('producto_id')
        .eq('tenant_id', args.tenantId)
        .eq('sucursal_id', args.sucursalId)
        .eq('plu', pluNorm),
      supabase
        .from('plu_sucursal')
        .select('producto_id')
        .eq('tenant_id', args.tenantId)
        .eq('sucursal_id', args.sucursalId),
    ]);
    overrideIds = (overrideRows ?? []).map((r) => r.producto_id);
    excludedFromGlobal = new Set((allOverrideRows ?? []).map((r) => r.producto_id));
  }

  const found: Record<string, unknown>[] = [];

  if (permitirPluSucursal && overrideIds.length > 0) {
    let q = supabase
      .from('producto')
      .select(args.select)
      .in('id', overrideIds)
      .eq('tenant_id', args.tenantId)
      .eq('activo', true);
    if (args.proveedorId) q = q.eq('proveedor_id', args.proveedorId);
    if (args.extraEq) {
      for (const [key, value] of Object.entries(args.extraEq)) {
        q = q.eq(key, value);
      }
    }
    const { data } = await q.limit(50);
    if (data?.length) found.push(...(data as unknown as Record<string, unknown>[]));
  }

  let qGlobal = supabase
    .from('producto')
    .select(args.select)
    .eq('tenant_id', args.tenantId)
    .eq('plu', pluNorm)
    .eq('activo', true);
  if (args.proveedorId) qGlobal = qGlobal.eq('proveedor_id', args.proveedorId);
  if (args.extraEq) {
    for (const [key, value] of Object.entries(args.extraEq)) {
      qGlobal = qGlobal.eq(key, value);
    }
  }
  if (permitirPluSucursal && excludedFromGlobal.size > 0) {
    qGlobal = qGlobal.not('id', 'in', `(${[...excludedFromGlobal].join(',')})`);
  }
  const { data: globalRows } = await qGlobal.limit(50);
  if (globalRows?.length) found.push(...(globalRows as unknown as Record<string, unknown>[]));

  const seen = new Set<string>();
  return found.filter((p) => {
    const id = String(p.id ?? '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Verifica que ningún otro producto activo tenga el mismo PLU efectivo en la sucursal. */
export async function pluDisponibleEnSucursal(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string;
    sucursalId: string;
    plu: string;
    excludeProductoId?: string;
  },
): Promise<boolean> {
  const pluNorm = normalizarPlu5(args.plu);
  if (!pluNorm) return true;

  let qOverride = supabase
    .from('plu_sucursal')
    .select('producto_id')
    .eq('tenant_id', args.tenantId)
    .eq('sucursal_id', args.sucursalId)
    .eq('plu', pluNorm);
  if (args.excludeProductoId) {
    qOverride = qOverride.neq('producto_id', args.excludeProductoId);
  }
  const { data: overrideConflict } = await qOverride.limit(1);
  if (overrideConflict?.length) return false;

  let qGlobal = supabase
    .from('producto')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('activo', true)
    .eq('plu', pluNorm);
  if (args.excludeProductoId) {
    qGlobal = qGlobal.neq('id', args.excludeProductoId);
  }
  const { data: globalMatches } = await qGlobal.limit(20);
  if (!globalMatches?.length) return true;

  const ids = globalMatches.map((r) => r.id);
  const { data: overridesForThose } = await supabase
    .from('plu_sucursal')
    .select('producto_id')
    .eq('tenant_id', args.tenantId)
    .eq('sucursal_id', args.sucursalId)
    .in('producto_id', ids);

  const withOverride = new Set((overridesForThose ?? []).map((r) => r.producto_id));
  return !globalMatches.some((r) => !withOverride.has(r.id));
}
