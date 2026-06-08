import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';

/**
 * Devuelve los lotes de ingreso (`producto_lote_ingreso`) de un producto, ordenados
 * por fecha de creación descendente. Usado por la pestaña «Lotes / Vencimientos» de
 * la ficha de producto.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { id } = await ctx.params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  }

  const { data, error } = await session.supabase
    .from('producto_lote_ingreso')
    .select(
      `id,
       cantidad,
       fecha_vencimiento,
       precio_costo,
       origen,
       importacion_log_id,
       lector_factura_log_id,
       movimiento_id,
       created_at,
       proveedor:proveedor_id(id, nombre),
       sucursal:sucursal_id(id, nombre, codigo)`,
    )
    .eq('tenant_id', session.tenantId)
    .eq('producto_id', id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lotes: data ?? [] });
}
