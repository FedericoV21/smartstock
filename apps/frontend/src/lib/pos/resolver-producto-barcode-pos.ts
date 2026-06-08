import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { fetchStockTotalVariantesPorProducto } from '@/lib/productos/variantes';

export type ProductoRow = Database['public']['Tables']['producto']['Row'];

export async function fetchStockSucursalPorProductoIds(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; sucursalId: string; productoIds: string[] },
): Promise<Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }>> {
  const out = new Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }>();
  if (args.productoIds.length === 0) return out;

  const { data, error } = await supabase
    .from('stock_sucursal')
    .select('producto_id, stock_actual, stock_minimo, ubicacion')
    .eq('tenant_id', args.tenantId)
    .eq('sucursal_id', args.sucursalId)
    .in('producto_id', args.productoIds);

  if (error || !data) return out;

  for (const r of data) {
    out.set(r.producto_id, {
      stock_actual: Number(r.stock_actual),
      stock_minimo: Number(r.stock_minimo),
      ubicacion: r.ubicacion,
    });
  }
  return out;
}

export async function fetchStockVendiblePorProductoIds(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; sucursalId: string; productos: ProductoRow[] },
): Promise<Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }>> {
  const ids = args.productos.map((p) => p.id);
  const base = await fetchStockSucursalPorProductoIds(supabase, {
    tenantId: args.tenantId,
    sucursalId: args.sucursalId,
    productoIds: ids,
  });
  const conVariantes = args.productos.filter((p) => p.usa_variantes).map((p) => p.id);
  if (conVariantes.length === 0) return base;
  const variantTotals = await fetchStockTotalVariantesPorProducto(supabase, {
    tenantId: args.tenantId,
    sucursalId: args.sucursalId,
    productoIds: conVariantes,
  });
  for (const productId of conVariantes) {
    const total = variantTotals.get(productId) ?? { stock_actual: 0, stock_minimo: 0 };
    base.set(productId, {
      stock_actual: total.stock_actual,
      stock_minimo: total.stock_minimo,
      ubicacion: base.get(productId)?.ubicacion ?? null,
    });
  }
  return base;
}

/**
 * Varias filas `producto` pueden compartir el mismo EAN en sucursales distintas (pre-fusión).
 * Elige una fila determinista para la caja: depósito “hogar” = sucursal de la caja; si no hay,
 * mayor `stock_sucursal.stock_actual` en esa caja; empate → `id` lexicográfico.
 */
export function pickProductoBarcodeParaSucursalCaja(
  rows: ProductoRow[],
  sucursalCajaId: string,
  stockEnCaja: Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }>,
): ProductoRow {
  if (rows.length === 1) return rows[0];

  const atHome = rows.filter((r) => r.sucursal_id === sucursalCajaId);
  if (atHome.length === 1) return atHome[0];
  if (atHome.length > 1) {
    return [...atHome].sort((a, b) => a.id.localeCompare(b.id))[0];
  }

  const scored = rows.map((r) => ({
    r,
    s: stockEnCaja.get(r.id)?.stock_actual ?? 0,
  }));
  scored.sort((a, b) => b.s - a.s || a.r.id.localeCompare(b.r.id));
  return scored[0].r;
}

/** Ajusta stock (y mínimo/ubicación) al depósito de la caja usando `stock_sucursal`. */
export function overlayStockProductoEnSucursalCaja(
  producto: ProductoRow,
  sucursalCajaId: string,
  stockEnCaja: Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }>,
): ProductoRow {
  const ss = stockEnCaja.get(producto.id);
  if (producto.usa_variantes) {
    return {
      ...producto,
      stock_actual: ss?.stock_actual ?? 0,
      stock_minimo: ss?.stock_minimo ?? producto.stock_minimo,
      ubicacion: ss?.ubicacion ?? producto.ubicacion,
    };
  }
  if (ss) {
    return {
      ...producto,
      stock_actual: ss.stock_actual,
      stock_minimo: ss.stock_minimo,
      ubicacion: ss.ubicacion ?? producto.ubicacion,
    };
  }
  if (producto.sucursal_id === sucursalCajaId) {
    return { ...producto };
  }
  return {
    ...producto,
    stock_actual: 0,
  };
}
