import type { SupabaseClient } from '@supabase/supabase-js';

import type { EmitirComprobanteBody } from '@/lib/facturacion/emitir-comprobante';
import type { Database } from '@/types/database';

/**
 * Construye el body para `emitirComprobante` a partir de un borrador existente y sus ítems.
 */
export async function emitirBodyDesdeBorrador(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  comprobanteId: string,
): Promise<EmitirComprobanteBody | null> {
  const { data: c, error } = await supabase
    .from('comprobante')
    .select(
      'id, tenant_id, estado, tipo, cliente_id, notas, caja_id, medio_pago_opcion_id, usuario_id',
    )
    .eq('id', comprobanteId)
    .maybeSingle();

  if (
    error ||
    !c ||
    c.tenant_id !== tenantId ||
    (c.estado !== 'borrador' && c.estado !== 'pendiente_posnet')
  ) {
    return null;
  }

  const { data: items, error: itemsErr } = await supabase
    .from('comprobante_item')
    .select('producto_id, cantidad, precio_unitario')
    .eq('comprobante_id', comprobanteId);

  if (itemsErr || !items?.length) {
    return null;
  }

  return {
    tipo: c.tipo as string,
    cliente_id: c.cliente_id,
    items: items.map((i) => ({
      producto_id: i.producto_id,
      cantidad: Number(i.cantidad),
      precio_unitario: Number(i.precio_unitario),
    })),
    notas: c.notas ?? undefined,
    metodo_pago: 'posnet_mp',
    medio_pago_opcion_id: c.medio_pago_opcion_id,
    caja_id: c.caja_id ?? undefined,
    stock_bloqueante: false,
  };
}
