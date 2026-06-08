import type { SupabaseClient } from '@supabase/supabase-js';

import { mergeProductosPrecioDesdeSucursal } from '@/lib/producto/precio-sucursal';
import { normalizarPreciosProductoPresentacionCompra } from '@/lib/producto/presentacion-compra';
import type { Database } from '@/types/database';

import {
  fetchStockVendiblePorProductoIds,
  overlayStockProductoEnSucursalCaja,
  pickProductoBarcodeParaSucursalCaja,
  type ProductoRow,
} from '@/lib/pos/resolver-producto-barcode-pos';

export function claveCatalogoCodigoUnidad(row: { codigo: string; unidad: string }): string {
  return `${row.codigo.trim().toLowerCase()}\0${row.unidad}`;
}

function cleanDedupePart(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function claveCatalogoEquivalente(row: {
  codigo: string;
  unidad: string;
  nombre?: string | null;
  proveedor_id?: string | null;
  codigo_barras?: string | null;
  plu?: string | null;
}): string {
  return [
    cleanDedupePart(row.codigo),
    cleanDedupePart(row.unidad),
    cleanDedupePart(row.nombre),
    cleanDedupePart(row.proveedor_id),
    cleanDedupePart(row.codigo_barras),
    cleanDedupePart(row.plu),
  ].join('\0');
}

/**
 * Varias filas `producto` equivalentes en distintas sucursales: una fila por clave,
 * priorizando hogar = caja y stock en depósito de la caja (misma regla que escaneo EAN).
 * La clave incluye nombre/proveedor/barra/PLU para no ocultar productos distintos que comparten codigo interno.
 */
export function dedupeProductosCatalogoParaCaja(
  rows: ProductoRow[],
  sucursalCajaId: string,
  stockEnCaja: Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }>,
): ProductoRow[] {
  const groups = new Map<string, ProductoRow[]>();
  for (const r of rows) {
    const k = claveCatalogoEquivalente(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const picked: ProductoRow[] = [];
  for (const g of groups.values()) {
    picked.push(pickProductoBarcodeParaSucursalCaja(g, sucursalCajaId, stockEnCaja));
  }
  picked.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  return picked;
}

/**
 * Ajusta `stock_*` y precios al depósito de la caja (`stock_sucursal`, `precio_sucursal`),
 * misma semántica que el escaneo por código de barras en POS.
 */
export async function enriquecerProductosPosConSucursalCaja(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalCajaId: string,
  rows: ProductoRow[],
  stockMapPrecargado?: Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }>,
): Promise<ProductoRow[]> {
  if (rows.length === 0) return [];

  const stockMap =
    stockMapPrecargado ??
    (await fetchStockVendiblePorProductoIds(supabase, {
      tenantId,
      sucursalId: sucursalCajaId,
      productos: rows,
    }));

  const conStock = rows.map((row) =>
    overlayStockProductoEnSucursalCaja(row, sucursalCajaId, stockMap),
  );
  const [merged, tenantRow] = await Promise.all([
    mergeProductosPrecioDesdeSucursal(supabase, tenantId, sucursalCajaId, conStock),
    supabase
      .from('tenant')
      .select('iva_porcentaje_default')
      .eq('id', tenantId)
      .maybeSingle(),
  ]);
  const ivaDefault = Number(tenantRow.data?.iva_porcentaje_default ?? 21) || 21;
  return merged.map((row) =>
    normalizarPreciosProductoPresentacionCompra(row, ivaDefault),
  );
}
