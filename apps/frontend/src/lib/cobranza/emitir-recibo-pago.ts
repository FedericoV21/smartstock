import type { SupabaseClient } from '@supabase/supabase-js';

import { emitirComprobante } from '@/lib/facturacion/emitir-comprobante';
import { formatearNumeroComprobante, formatearTipoComprobante } from '@/lib/facturacion/formato';
import type { Database } from '@/types/database';

type Ctx = { tenantId: string; userId: string };

/**
 * Emite un comprobante `recibo` (sin ARCA, sin stock) y lo vincula al `cobranza_pago`.
 * Requiere al menos un producto activo en el tenant (línea técnica para `comprobante_item`).
 */
export async function emitirReciboTrasPagoCobranza(
  supabase: SupabaseClient<Database>,
  ctx: Ctx,
  params: {
    clienteId: string;
    monto: number;
    cobranzaPagoId: string;
    comprobanteFacturaId: string;
    tipoPago: Database['public']['Enums']['tipo_pago'];
    /** Texto libre del POST de cobro (opcional). */
    notasCobro: string | null;
  },
): Promise<{ ok: true; comprobanteId: string; pdfUrl: string | null } | { ok: false; error: string }> {
  const { data: tenant } = await supabase
    .from('tenant')
    .select('punto_de_venta')
    .eq('id', ctx.tenantId)
    .maybeSingle();

  const { data: fac } = await supabase
    .from('comprobante')
    .select('numero, tipo')
    .eq('id', params.comprobanteFacturaId)
    .maybeSingle();

  const pv = tenant?.punto_de_venta ?? 1;
  const refLabel = fac
    ? `${formatearTipoComprobante(fac.tipo)} ${formatearNumeroComprobante(pv, fac.numero)}`
    : params.comprobanteFacturaId;

  const { data: prod } = await supabase
    .from('producto')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('activo', true)
    .limit(1)
    .maybeSingle();

  if (!prod?.id) {
    return {
      ok: false,
      error:
        'Para generar el PDF del recibo hace falta al menos un producto activo en el catálogo (línea interna).',
    };
  }

  const notas = [`Recibo por cobro de ${refLabel}.`, params.notasCobro?.trim() || null]
    .filter(Boolean)
    .join('\n');

  const metodoPagoEmit =
    params.tipoPago === 'tarjeta'
      ? ('credito' as const)
      : params.tipoPago === 'efectivo'
        ? ('efectivo' as const)
        : ('transferencia' as const);

  const emit = await emitirComprobante(supabase, ctx, {
    tipo: 'recibo',
    cliente_id: params.clienteId,
    items: [{ producto_id: prod.id, cantidad: 1, precio_unitario: params.monto }],
    notas,
    metodo_pago: metodoPagoEmit,
  });

  if (!emit.ok) {
    return { ok: false, error: emit.error };
  }

  const { error: upErr } = await supabase
    .from('cobranza_pago')
    .update({ recibo_comprobante_id: emit.data.comprobante.id })
    .eq('id', params.cobranzaPagoId);

  if (upErr) {
    return {
      ok: false,
      error: `El recibo se emitió pero no se pudo vincular al cobro: ${upErr.message}`,
    };
  }

  return {
    ok: true,
    comprobanteId: emit.data.comprobante.id,
    pdfUrl: emit.data.comprobante.pdf_url ?? null,
  };
}
