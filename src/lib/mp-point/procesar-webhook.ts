import type { SupabaseClient } from '@supabase/supabase-js';

import { emitirComprobante } from '@/lib/facturacion/emitir-comprobante';
import { emitirBodyDesdeBorrador } from '@/lib/mp-point/borrador-body';
import { broadcastMpPointEvent } from '@/lib/mp-point/broadcast';
import { getMpPointClient } from '@/lib/mp-point/client';
import { decryptAccessToken, loadMpPointConfig } from '@/lib/mp-point/load-config';
import type { Database } from '@/types/database';

export async function procesarNotificacionMpPointIntent(
  admin: SupabaseClient<Database>,
  params: { intentId: string },
): Promise<void> {
  const { intentId } = params;

  const { data: comp, error: qErr } = await admin
    .from('comprobante')
    .select('id, tenant_id, estado, mp_point_intent_id, mp_point_payment_id, usuario_id')
    .eq('mp_point_intent_id', intentId)
    .maybeSingle();

  if (qErr || !comp) {
    console.warn('[mp-point webhook] comprobante no encontrado para intent', intentId);
    return;
  }

  if (comp.mp_point_payment_id != null) {
    return;
  }

  const { data: cfg, error: cfgErr } = await loadMpPointConfig(admin, comp.tenant_id);
  if (cfgErr || !cfg?.access_token || !cfg.device_id) {
    console.error('[mp-point webhook] sin config', comp.tenant_id, cfgErr);
    return;
  }

  const token = decryptAccessToken(cfg.access_token);
  if (!token) {
    console.error('[mp-point webhook] token inválido tenant', comp.tenant_id);
    return;
  }

  const client = getMpPointClient(token);
  let intent;
  try {
    intent = await client.getPaymentIntent(cfg.device_id, intentId);
  } catch (e) {
    console.error('[mp-point webhook] getPaymentIntent', e);
    return;
  }

  const paymentId = intent.payment?.id;
  const payState = intent.payment?.state;

  if (intent.state === 'FINISHED' && payState === 'approved' && paymentId != null) {
    let uid = comp.usuario_id;
    if (!uid) {
      const { data: u } = await admin
        .from('usuario')
        .select('id')
        .eq('tenant_id', comp.tenant_id)
        .limit(1)
        .maybeSingle();
      uid = u?.id ?? null;
    }
    if (!uid) {
      console.error('[mp-point webhook] sin usuario en tenant', comp.tenant_id);
      return;
    }

    const body = await emitirBodyDesdeBorrador(admin, comp.tenant_id, comp.id);
    if (!body) {
      console.error('[mp-point webhook] no se pudo armar body desde borrador/pendiente', comp.id);
      return;
    }
    const result = await emitirComprobante(
      admin,
      { tenantId: comp.tenant_id, userId: uid },
      body,
      {
        reemplazarComprobanteBorradorId: comp.id,
        mpPointPaymentId: paymentId,
      },
    );
    if (!result.ok) {
      console.error('[mp-point webhook] emitir falló', result.error);
      return;
    }

    void broadcastMpPointEvent(comp.id, {
      estado: 'aprobado',
      payment_id: paymentId,
      payment_type: intent.payment?.type,
    }).catch(() => {});
    return;
  }

  if (intent.state === 'FINISHED' && payState && payState !== 'approved') {
    const { error } = await admin
      .from('comprobante')
      .update({
        estado: 'borrador' as never,
        mp_point_intent_id: null,
      })
      .eq('id', comp.id)
      .eq('tenant_id', comp.tenant_id);
    if (error) console.error('[mp-point webhook] rechazo DB', error);
    void broadcastMpPointEvent(comp.id, { estado: 'rechazado', motivo: payState }).catch(() => {});
    return;
  }

  if (intent.state === 'CANCELED') {
    const { error } = await admin
      .from('comprobante')
      .update({
        estado: 'borrador' as never,
        mp_point_intent_id: null,
      })
      .eq('id', comp.id)
      .eq('tenant_id', comp.tenant_id);
    if (error) console.error('[mp-point webhook] canceled DB', error);
    void broadcastMpPointEvent(comp.id, { estado: 'cancelado' }).catch(() => {});
    return;
  }

  if (intent.state === 'ERROR') {
    console.error('[mp-point webhook] intent ERROR', intentId);
    const { error } = await admin
      .from('comprobante')
      .update({
        estado: 'borrador' as never,
        mp_point_intent_id: null,
      })
      .eq('id', comp.id)
      .eq('tenant_id', comp.tenant_id);
    if (error) console.error('[mp-point webhook] error DB', error);
    void broadcastMpPointEvent(comp.id, { estado: 'error' }).catch(() => {});
  }
}
