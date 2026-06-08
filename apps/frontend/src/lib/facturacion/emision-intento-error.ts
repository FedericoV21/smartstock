import type { SupabaseClient } from '@supabase/supabase-js';

import type { EmitirComprobanteBody } from '@/lib/facturacion/emitir-comprobante';
import type { Database, Json } from '@/types/database';

type SupabaseUntyped = {
  from(table: string): {
    insert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
  };
};

type RegistrarIntentoErrorParams = {
  supabase: SupabaseClient<Database>;
  tenantId: string;
  userId: string;
  sucursalId: string;
  body: EmitirComprobanteBody;
  status: number;
  error: string;
};

function inferirEtapa(error: string, status: number): string {
  const e = error.toLowerCase();
  if (e.includes('pago') || e.includes('monto') || e.includes('cuenta corriente')) return 'pago';
  if (e.includes('stock')) return 'stock';
  if (e.includes('caja') || e.includes('turno')) return 'caja';
  if (e.includes('cliente') || e.includes('cuit') || e.includes('iva')) return 'cliente';
  if (e.includes('arca') || e.includes('afip') || e.includes('cae')) return 'arca';
  if (status >= 500) return 'servidor';
  return 'validacion';
}

function totalEstimado(body: EmitirComprobanteBody): number | null {
  const total = body.items.reduce((sum, item) => {
    const cantidad = Number(item.cantidad);
    const precio = Number(item.precio_unitario);
    if (!Number.isFinite(cantidad) || !Number.isFinite(precio)) return sum;
    return sum + cantidad * precio;
  }, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round(total * 100) / 100;
}

function resumenItems(body: EmitirComprobanteBody): Json {
  return body.items.slice(0, 30).map((item) => ({
    producto_id: 'producto_id' in item ? item.producto_id : null,
    tipo: 'tipo' in item ? item.tipo : null,
    cantidad: Number(item.cantidad) || 0,
    precio_unitario: Number(item.precio_unitario) || 0,
    producto_nuevo:
      'producto_nuevo' in item && item.producto_nuevo
        ? {
            nombre: item.producto_nuevo.nombre,
            codigo: item.producto_nuevo.codigo ?? null,
          }
        : null,
  }));
}

export async function registrarIntentoEmisionFallido({
  supabase,
  tenantId,
  userId,
  sucursalId,
  body,
  status,
  error,
}: RegistrarIntentoErrorParams): Promise<void> {
  const db = supabase as unknown as SupabaseUntyped;
  const { error: insertError } = await db.from('emision_intento_error').insert({
    tenant_id: tenantId,
    sucursal_id: sucursalId,
    usuario_id: userId,
    cliente_id: body.cliente_id ?? null,
    origen: body.tipo === 'ticket' ? 'pos' : 'facturacion_emitir',
    etapa: inferirEtapa(error, status),
    tipo: body.tipo ?? null,
    caja_id: body.caja_id ?? null,
    metodo_pago: body.metodo_pago ?? null,
    metodo_pago_detalle: (body.metodo_pago_detalle ?? null) as Json | null,
    total_estimado: totalEstimado(body),
    items_count: body.items.length,
    items_resumen: resumenItems(body),
    request_payload: body as unknown as Json,
    error_status: status,
    error_mensaje: error,
  });

  if (insertError) {
    console.warn('[emision_intento_error] no se pudo registrar intento fallido:', insertError.message);
  }
}
