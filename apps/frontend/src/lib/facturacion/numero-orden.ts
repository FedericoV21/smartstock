import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

type Db = SupabaseClient<Database>;

type OrigenKind = 'comprobante' | 'pedido';

/**
 * Asegura que el origen tenga `numero_orden`: si ya tiene lo devuelve, si no
 * pide uno nuevo con `siguiente_numero_orden` (contempla comprobante + pedido
 * desde la migración 067) y lo persiste en el origen.
 */
export async function asegurarNumeroOrdenOrigen(
  supabase: Db,
  opts: {
    tenantId: string;
    origen: OrigenKind;
    origenId: string;
    numeroOrdenActual: number | null | undefined;
  },
): Promise<{ ok: true; numeroOrden: number } | { ok: false; status: number; error: string }> {
  if (opts.numeroOrdenActual != null && Number.isFinite(Number(opts.numeroOrdenActual))) {
    return { ok: true, numeroOrden: Number(opts.numeroOrdenActual) };
  }

  const { data, error } = await supabase.rpc('siguiente_numero_orden', {
    p_tenant_id: opts.tenantId,
  });
  if (error) return { ok: false, status: 500, error: error.message };
  if (data == null || typeof data !== 'number') {
    return { ok: false, status: 500, error: 'No se pudo obtener el número de orden' };
  }

  const numeroOrden = data;
  const tabla = opts.origen === 'comprobante' ? 'comprobante' : 'pedido';
  const { error: updErr } = await supabase
    .from(tabla)
    .update({ numero_orden: numeroOrden })
    .eq('id', opts.origenId)
    .eq('tenant_id', opts.tenantId);

  if (updErr) {
    return { ok: false, status: 500, error: updErr.message };
  }

  return { ok: true, numeroOrden };
}

/**
 * Si el origen tiene `numero_orden`, valida que no exista ya una factura A/B/C
 * emitida bajo esa orden. Evita refacturar la misma orden (alineado con la
 * validación en `emitirComprobante`).
 */
export async function validarOrdenSinFacturaFiscal(
  supabase: Db,
  opts: { tenantId: string; numeroOrden: number | null | undefined },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (opts.numeroOrden == null) return { ok: true };

  const { data, error } = await supabase
    .from('comprobante')
    .select('id')
    .eq('tenant_id', opts.tenantId)
    .eq('numero_orden', opts.numeroOrden)
    .in('tipo', ['factura_a', 'factura_b', 'factura_c'])
    .eq('estado', 'emitido')
    .limit(1);

  if (error) return { ok: false, status: 500, error: error.message };
  if (data?.length) {
    return {
      ok: false,
      status: 409,
      error: 'Ya existe una factura fiscal emitida para esta orden de venta.',
    };
  }
  return { ok: true };
}

/**
 * Evita emitir un segundo ticket no fiscal bajo el mismo `numero_orden` (p. ej. doble
 * "ticket desde presupuesto" o ticket + otro comprobante de venta bajo la misma orden).
 */
export async function validarOrdenSinTicketEmitido(
  supabase: Db,
  opts: { tenantId: string; numeroOrden: number | null | undefined },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (opts.numeroOrden == null) return { ok: true };

  const { data, error } = await supabase
    .from('comprobante')
    .select('id, numero')
    .eq('tenant_id', opts.tenantId)
    .eq('numero_orden', opts.numeroOrden)
    .eq('tipo', 'ticket')
    .eq('estado', 'emitido')
    .limit(1);

  if (error) return { ok: false, status: 500, error: error.message };
  if (data?.length) {
    return {
      ok: false,
      status: 409,
      error:
        'Ya existe un ticket emitido para esta orden de venta. Podés abrirlo en Facturación o fiscalizarlo si aún no tiene factura.',
    };
  }
  return { ok: true };
}
