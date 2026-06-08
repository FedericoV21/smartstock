import type { SupabaseClient } from '@supabase/supabase-js';

import { aplicarPromociones } from '@/lib/facturacion/promociones';
import { precioUnitarioLineaEmitirConTramos } from '@/lib/facturacion/precio-unitario-linea-emitir';
import { cargarMapaPromocionesVigentes } from '@/lib/promociones/cargar-mapa';
import { mergeProductosPrecioDesdeSucursal } from '@/lib/producto/precio-sucursal';
import { fetchMapaGananciaTramosPorProductoIds } from '@/lib/productos/fetch-ganancia-tramos-batch';
import type { Database } from '@/types/database';

export type ItemPedidoBase = {
  producto_id: string;
  producto_variante_id?: string | null;
  cantidad: number;
  precio_unitario: number;
};

/** Filas listas para `pedido_item` (sin `pedido_id`). Precio y subtotal ya con promo congelada. */
export async function prepararFilasPedidoItemConPromos(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
  items: ItemPedidoBase[],
  fechaPedidoYmd: string,
): Promise<{
  filas: Omit<Database['public']['Tables']['pedido_item']['Insert'], 'pedido_id'>[];
  total: number;
}> {
  const productoIds = [...new Set(items.map((i) => i.producto_id))];

  const { data: tenantRow } = await supabase
    .from('tenant')
    .select('iva_porcentaje_default')
    .eq('id', tenantId)
    .maybeSingle();
  const ivaDefault = Number(tenantRow?.iva_porcentaje_default ?? 21) || 21;

  const { data: productos, error: pErr } = await supabase
    .from('producto')
    .select('id, precio_costo, precio_venta, iva_porcentaje, porcentaje_ganancia, descuento_costo_pct, es_pesable')
    .in('id', productoIds)
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursalId);

  if (pErr) throw new Error(pErr.message);

  const productosConPrecio = await mergeProductosPrecioDesdeSucursal(
    supabase,
    tenantId,
    sucursalId,
    productos ?? [],
  );
  const mapProd = new Map(productosConPrecio.map((p) => [p.id, p]));
  const tramosPorProducto = await fetchMapaGananciaTramosPorProductoIds(
    supabase,
    tenantId,
    productoIds,
  );

  const itemsConPrecio = items.map((i) => {
    const prod = mapProd.get(i.producto_id);
    if (!prod) return i;
    const precio_unitario = precioUnitarioLineaEmitirConTramos(
      i,
      prod,
      tramosPorProducto.get(i.producto_id) ?? null,
      ivaDefault,
      false,
    );
    return { ...i, precio_unitario };
  });

  const promosPorProducto = await cargarMapaPromocionesVigentes(
    supabase,
    tenantId,
    productoIds,
    fechaPedidoYmd,
    sucursalId,
  );

  const itemsConPromo = aplicarPromociones(
    itemsConPrecio.map((i) => ({
      producto_id: i.producto_id,
      producto_variante_id: i.producto_variante_id ?? null,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      es_pesable: mapProd.get(i.producto_id)?.es_pesable === true,
    })),
    promosPorProducto,
    fechaPedidoYmd,
  );

  const filas: Omit<Database['public']['Tables']['pedido_item']['Insert'], 'pedido_id'>[] =
    itemsConPromo.map((row) => {
      const subtotal = Math.round(row.cantidad * row.precio_unitario_efectivo * 100) / 100;
      return {
        producto_id: row.producto_id,
        producto_variante_id: row.producto_variante_id ?? null,
        cantidad: row.cantidad,
        precio_unitario: row.precio_unitario_efectivo,
        subtotal,
        promocion_id: row.promocion_id,
        promocion_descripcion: row.promocion_descripcion,
        precio_unitario_original: row.precio_unitario_original,
        descuento_promo_monto: row.descuento_promo_monto,
      };
    });

  const total = Math.round(filas.reduce((s, f) => s + f.subtotal, 0) * 100) / 100;

  return { filas, total };
}
