import type { SupabaseClient } from '@supabase/supabase-js';

import { effectivePosPrefsFromRows } from '@/lib/pos/prefs';
import { calcularPrecioVenta } from '@/lib/productos/calcular-precio-venta';
import type { Database } from '@/types/database';

export type ProductoConPrecio = {
  precio_costo: number;
  precio_venta: number;
  porcentaje_ganancia?: number | null;
};

export type PrecioSucursalOverride = {
  precio_costo: number | null;
  precio_venta: number | null;
  porcentaje_ganancia: number | null;
};

export type ProductoPrecioSucursalMeta = {
  /** True si la fila de precio_sucursal tiene una ganancia propia y el PVP es derivado. */
  precio_sucursal_ganancia_aplicada?: boolean;
  /** True si la fila legacy trae PVP manual sin ganancia propia. */
  precio_sucursal_manual?: boolean;
};

/**
 * Override opcional por deposito (`precio_sucursal`). Si no hay fila, devuelve `null`.
 */
export async function fetchPrecioSucursalOverride(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; productoId: string; sucursalId: string },
): Promise<PrecioSucursalOverride | null> {
  const { data, error } = await supabase
    .from('precio_sucursal')
    .select('precio_costo, precio_venta, porcentaje_ganancia')
    .eq('tenant_id', args.tenantId)
    .eq('producto_id', args.productoId)
    .eq('sucursal_id', args.sucursalId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    precio_costo: data.precio_costo != null ? Number(data.precio_costo) : null,
    precio_venta: data.precio_venta != null ? Number(data.precio_venta) : null,
    porcentaje_ganancia:
      data.porcentaje_ganancia != null ? Number(data.porcentaje_ganancia) : null,
  };
}

/** Aplica override por sucursal: cada campo null en el override conserva el valor del producto. */
export function mergePrecioProductoConSucursal<P extends ProductoConPrecio>(
  producto: P,
  override: PrecioSucursalOverride | null,
): P & ProductoPrecioSucursalMeta {
  if (!override) return producto;

  const precio_costo =
    override.precio_costo != null ? override.precio_costo : producto.precio_costo;
  const precio_venta =
    override.precio_venta != null ? override.precio_venta : producto.precio_venta;
  const tieneGananciaSucursal = override.porcentaje_ganancia != null;
  const porcentaje_ganancia = tieneGananciaSucursal
    ? override.porcentaje_ganancia
    : producto.porcentaje_ganancia;
  const precioSucursalManual = !tieneGananciaSucursal && override.precio_venta != null;

  return {
    ...producto,
    precio_costo,
    precio_venta,
    porcentaje_ganancia,
    ...(tieneGananciaSucursal ? { precio_sucursal_ganancia_aplicada: true } : {}),
    ...(precioSucursalManual ? { precio_sucursal_manual: true } : {}),
  };
}

export async function mergeProductoPrecioDesdeSucursal<P extends ProductoConPrecio & { id: string }>(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
  producto: P,
): Promise<P & ProductoPrecioSucursalMeta> {
  const o = await fetchPrecioSucursalOverride(supabase, {
    tenantId,
    productoId: producto.id,
    sucursalId,
  });
  return mergePrecioProductoConSucursal(producto, o);
}

export async function mergeProductosPrecioDesdeSucursal<P extends ProductoConPrecio & { id: string }>(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
  productos: P[],
): Promise<Array<P & ProductoPrecioSucursalMeta>> {
  if (productos.length === 0) return [];

  const ids = [...new Set(productos.map((p) => p.id).filter(Boolean))];
  const { data } = await supabase
    .from('precio_sucursal')
    .select('producto_id, precio_costo, precio_venta, porcentaje_ganancia')
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursalId)
    .in('producto_id', ids);

  const precioMap = new Map<string, PrecioSucursalOverride>();
  for (const p of data ?? []) {
    precioMap.set(p.producto_id, {
      precio_costo: p.precio_costo != null ? Number(p.precio_costo) : null,
      precio_venta: p.precio_venta != null ? Number(p.precio_venta) : null,
      porcentaje_ganancia:
        p.porcentaje_ganancia != null ? Number(p.porcentaje_ganancia) : null,
    });
  }

  return productos.map((producto) =>
    mergePrecioProductoConSucursal(producto, precioMap.get(producto.id) ?? null),
  );
}

type ProductoBaseRecalculoSucursal = {
  precio_costo: number | null;
  iva_porcentaje?: number | null;
  descuento_costo_pct?: number | null;
};

/**
 * Recalcula los PVP de `precio_sucursal` que tienen ganancia propia.
 * Las filas legacy sin `porcentaje_ganancia` quedan intactas.
 */
export async function recalcularPreciosSucursalConGanancia(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string;
    productoId: string;
    producto?: ProductoBaseRecalculoSucursal | null;
  },
): Promise<void> {
  let producto = args.producto ?? null;
  if (!producto) {
    const { data } = await supabase
      .from('producto')
      .select('precio_costo, iva_porcentaje, descuento_costo_pct')
      .eq('id', args.productoId)
      .eq('tenant_id', args.tenantId)
      .maybeSingle();
    producto = data;
  }
  if (!producto) return;

  const { data: rows } = await supabase
    .from('precio_sucursal')
    .select('id, sucursal_id, precio_costo, porcentaje_ganancia')
    .eq('tenant_id', args.tenantId)
    .eq('producto_id', args.productoId)
    .not('porcentaje_ganancia', 'is', null);
  if (!rows || rows.length === 0) return;

  const [{ data: tenantRow }, { data: sucRows }] = await Promise.all([
    supabase
      .from('tenant')
      .select('iva_porcentaje_default, pos_prefs')
      .eq('id', args.tenantId)
      .maybeSingle(),
    supabase
      .from('sucursal')
      .select('id, pos_prefs')
      .eq('tenant_id', args.tenantId)
      .in('id', [...new Set(rows.map((r) => r.sucursal_id))]),
  ]);

  const ivaDefault = Number(tenantRow?.iva_porcentaje_default ?? 21) || 21;
  const sucPrefs = new Map((sucRows ?? []).map((s) => [s.id, s.pos_prefs] as const));

  await Promise.all(
    rows.map((row) => {
      const costo =
        row.precio_costo != null ? Number(row.precio_costo) : Number(producto.precio_costo ?? 0);
      const prefs = effectivePosPrefsFromRows(
        tenantRow?.pos_prefs,
        sucPrefs.get(row.sucursal_id) ?? null,
      );
      const precioVenta = calcularPrecioVenta(
        costo,
        row.porcentaje_ganancia != null ? Number(row.porcentaje_ganancia) : 0,
        producto.iva_porcentaje ?? null,
        ivaDefault,
        {
          redondearPreciosCentenas: prefs.pvpRedondeoCentenasArriba,
          redondearMenores100ADecenas: prefs.pvpRedondeoMenores100ADecenas,
          descuentoCostoPct: producto.descuento_costo_pct ?? null,
        },
      );
      return supabase
        .from('precio_sucursal')
        .update({ precio_venta: precioVenta })
        .eq('id', row.id)
        .eq('tenant_id', args.tenantId);
    }),
  );
}
