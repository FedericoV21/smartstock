import type { SupabaseClient } from '@supabase/supabase-js';

import type { MpPointClient } from '@/lib/mp-point/client';
import { MpPointError } from '@/lib/mp-point/client';
import { fetchMercadoPagoPaymentV1, pagoV1PermiteEmitirComprobante } from '@/lib/mp-point/payment-v1';
import type { Database } from '@/types/database';

async function clearLastPaymentIntentIfMatches(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  intentId: string,
): Promise<void> {
  await supabase
    .from('mp_point_config')
    .update({ last_payment_intent_id: null })
    .eq('tenant_id', tenantId)
    .eq('last_payment_intent_id', intentId);
}

/**
 * Libera intents de MP Point: cancela en la API si siguen activos y limpia `mp_point_intent_id` en
 * comprobantes. Incluye `mp_point_config.last_payment_intent_id` para intents huérfanos (borrador
 * borrado). No cancela FINISHED + pago aprobado en v1 (emisión en curso); solo limpia esa marca en
 * config. `mercadoPagoAccessToken`: token de la app, para `GET /v1/payments/{id}`.
 */
export async function releaseStoredMpPointIntentsForTenant(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  deviceId: string,
  client: MpPointClient,
  mercadoPagoAccessToken: string,
): Promise<void> {
  const { data: cfgRow } = await supabase
    .from('mp_point_config')
    .select('last_payment_intent_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const { data: rows, error: qErr } = await supabase
    .from('comprobante')
    .select('id, mp_point_intent_id')
    .eq('tenant_id', tenantId)
    .not('mp_point_intent_id', 'is', null);

  if (qErr) {
    console.error('[mp-point] release query comprobantes', qErr);
  }

  const intentIdSet = new Set<string>();
  for (const r of rows ?? []) {
    const id = r.mp_point_intent_id?.trim();
    if (id) intentIdSet.add(id);
  }
  const last = cfgRow?.last_payment_intent_id?.trim();
  if (last) intentIdSet.add(last);

  const intentIds = [...intentIdSet];
  if (!intentIds.length) return;

  const intentIdsToClear: string[] = [];

  for (const intentId of intentIds) {
    let clear = false;
    try {
      const prev = await client.getPaymentIntent(deviceId, intentId);
      if (prev.state === 'FINISHED' && prev.payment?.id) {
        const v1 = await fetchMercadoPagoPaymentV1(mercadoPagoAccessToken, Number(prev.payment.id));
        if (v1 && pagoV1PermiteEmitirComprobante(v1)) {
          await clearLastPaymentIntentIfMatches(supabase, tenantId, intentId);
          continue;
        }
      }
      if (
        prev.state === 'OPEN' ||
        prev.state === 'ON_TERMINAL' ||
        prev.state === 'PROCESSING'
      ) {
        try {
          await client.cancelPaymentIntent(deviceId, intentId);
        } catch (e) {
          if (e instanceof MpPointError && (e.status === 422 || e.status === 404)) {
            /* ya no cancelable vía API */
          } else {
            console.error('[mp-point] release cancel', intentId, e);
          }
        }
      }
      clear = true;
    } catch (e) {
      if (e instanceof MpPointError && (e.status === 422 || e.status === 404)) {
        clear = true;
      } else {
        console.error('[mp-point] release get', intentId, e);
      }
    }
    if (clear) intentIdsToClear.push(intentId);
  }

  for (const intentId of intentIdsToClear) {
    const { error: upErr } = await supabase
      .from('comprobante')
      .update({
        estado: 'borrador' as never,
        mp_point_intent_id: null,
      })
      .eq('tenant_id', tenantId)
      .eq('mp_point_intent_id', intentId);
    if (upErr) {
      console.error('[mp-point] release DB', intentId, upErr);
    }
    await clearLastPaymentIntentIfMatches(supabase, tenantId, intentId);
  }
}
