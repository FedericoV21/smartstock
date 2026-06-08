import type { SupabaseClient } from '@supabase/supabase-js';

import {
  caeAfipFormatoValido,
  puedeAnularComprobanteInterno,
} from '@/lib/facturacion/cae-afip';
import { formatearTipoComprobante } from '@/lib/facturacion/formato';
import type { Database } from '@/types/database';

type Result = { ok: true } | { ok: false; status: number; error: string };

export const MOTIVO_ANULACION_MIN_LEN = 5;
export const MOTIVO_ANULACION_MAX_LEN = 4000;
const MOTIVO_MOVIMIENTO_USER_MAX = 3500;

export type ValidarMotivoResult =
  | { ok: true; motivo: string }
  | { ok: false; status: number; error: string };

export function validarMotivoAnulacion(
  motivo: string | undefined | null,
): ValidarMotivoResult {
  const m = typeof motivo === 'string' ? motivo.trim() : '';
  if (m.length < MOTIVO_ANULACION_MIN_LEN) {
    return {
      ok: false,
      status: 400,
      error: `El motivo de anulación debe tener al menos ${MOTIVO_ANULACION_MIN_LEN} caracteres.`,
    };
  }
  if (m.length > MOTIVO_ANULACION_MAX_LEN) {
    return {
      ok: false,
      status: 400,
      error: `El motivo de anulación no puede superar ${MOTIVO_ANULACION_MAX_LEN} caracteres.`,
    };
  }
  return { ok: true, motivo: m };
}

/**
 * Anula un comprobante sin CAE AFIP válido o en error/pendiente ARCA:
 * devuelve stock, revierte cuenta corriente según cobranza y deja motivo/auditoría.
 * No llama a ARCA. Si el comprobante tiene CAE válido, rechaza (usar NC fiscal).
 */
export async function anularComprobanteSinCae(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; userId: string },
  comprobanteId: string,
  motivoAnulacion: string,
): Promise<Result> {
  const motivoVal = validarMotivoAnulacion(motivoAnulacion);
  if (!motivoVal.ok) return motivoVal;

  const { data: comp, error: cErr } = await supabase
    .from('comprobante')
    .select(
      'id, tenant_id, sucursal_id, tipo, estado, cae, total, tipo_operacion, metodo_pago',
    )
    .eq('id', comprobanteId)
    .maybeSingle();

  if (cErr || !comp) {
    return { ok: false, status: 500, error: cErr?.message ?? 'Comprobante no encontrado' };
  }
  if (comp.tenant_id !== ctx.tenantId) {
    return { ok: false, status: 404, error: 'Comprobante no encontrado' };
  }

  const regla = puedeAnularComprobanteInterno({
    estado: comp.estado,
    tipo: comp.tipo,
    cae: comp.cae,
    tipoOperacion: comp.tipo_operacion,
  });
  if (!regla.ok) {
    return { ok: false, status: regla.status, error: regla.error };
  }

  if (comp.cae != null && caeAfipFormatoValido(comp.cae)) {
    return {
      ok: false,
      status: 400,
      error: 'El comprobante ya tiene CAE AFIP válido. Usá el flujo de nota de crédito.',
    };
  }

  const motivoMovUser =
    motivoVal.motivo.length > MOTIVO_MOVIMIENTO_USER_MAX
      ? `${motivoVal.motivo.slice(0, MOTIVO_MOVIMIENTO_USER_MAX)}…`
      : motivoVal.motivo;

  const { data: items, error: iErr } = await supabase
    .from('comprobante_item')
    .select('producto_id, cantidad')
    .eq('comprobante_id', comprobanteId);
  if (iErr) {
    return { ok: false, status: 500, error: iErr.message };
  }

  const esPresupuestoRecibo = comp.tipo === 'presupuesto' || comp.tipo === 'recibo';
  const esReingreso = comp.tipo.startsWith('nota_credito') || comp.tipo === 'devolucion_remito';
  if (!esPresupuestoRecibo) {
    const movAnular = esReingreso ? 'salida' : 'entrada';
    for (const it of items ?? []) {
      const { error: mErr } = await supabase.rpc('registrar_movimiento', {
        p_tenant_id: ctx.tenantId,
        p_producto_id: it.producto_id,
        p_sucursal_id: comp.sucursal_id,
        p_tipo: movAnular,
        p_cantidad: it.cantidad,
        p_motivo: `Anula ${formatearTipoComprobante(comp.tipo)} (reverso interno) · ${comprobanteId.slice(0, 8)}… — ${motivoMovUser}`,
        p_referencia_tipo: 'factura' as const,
        p_referencia_id: comprobanteId,
        p_usuario_id: ctx.userId,
      });
      if (mErr) {
        return { ok: false, status: 500, error: `Stock: ${mErr.message}` };
      }
    }
  }

  const { data: cob, error: cobErr } = await supabase
    .from('cobranza_factura')
    .select('id, saldo_pendiente, cliente_id, tenant_id')
    .eq('comprobante_id', comprobanteId)
    .maybeSingle();

  if (!cobErr && cob && cob.saldo_pendiente > 0.001) {
    const { data: cuenta } = await supabase
      .from('cuenta_corriente')
      .select('id, saldo')
      .eq('tenant_id', ctx.tenantId)
      .eq('cliente_id', cob.cliente_id)
      .maybeSingle();
    if (cuenta) {
      await supabase
        .from('cuenta_corriente')
        .update({ saldo: Number(cuenta.saldo) - Number(cob.saldo_pendiente) })
        .eq('id', cuenta.id);
    }
    await supabase
      .from('cobranza_factura')
      .update({ saldo_pendiente: 0 })
      .eq('id', cob.id);
  }

  const anuladoAt = new Date().toISOString();
  const { error: uErr } = await supabase
    .from('comprobante')
    .update({
      estado: 'anulado' as never,
      pdf_url: null,
      motivo_anulacion: motivoVal.motivo as never,
      anulado_at: anuladoAt as never,
      anulado_por: ctx.userId as never,
    })
    .eq('id', comprobanteId);
  if (uErr) {
    return { ok: false, status: 500, error: uErr.message };
  }

  if (String(comp.metodo_pago ?? '').trim() === 'transferencia_mp') {
    const { error: mpErr } = await supabase
      .from('mp_transferencia_verificacion')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('comprobante_id', comprobanteId);
    if (mpErr) {
      return { ok: false, status: 500, error: `Transferencia MP: ${mpErr.message}` };
    }
  }

  return { ok: true };
}
