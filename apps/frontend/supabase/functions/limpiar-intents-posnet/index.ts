/**
 * Limpia comprobantes en `pendiente_posnet` con más de 10 min sin actualizar: cancela el intent en
 * Mercado Pago Point y vuelve el comprobante a `borrador`.
 *
 * Programar en Supabase Dashboard → Edge Functions → Schedules (p. ej. cada 15 minutos).
 *
 * Secretos: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (automáticos), ARCA_ENCRYPTION_KEY (mismo que la app).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MP_API = 'https://api.mercadopago.com/point/integration-api';
const MINUTOS_COLGADO = 10;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function aes256CbcDecryptAsync(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, data);
  return new TextDecoder().decode(decrypted);
}

async function desencriptarTokenMp(valorEncriptado: string): Promise<string> {
  const key = Deno.env.get('ARCA_ENCRYPTION_KEY');
  if (!key) throw new Error('ARCA_ENCRYPTION_KEY no configurada');
  const [ivHex, encrypted] = valorEncriptado.split(':');
  if (!ivHex || !encrypted) throw new Error('Token cifrado inválido');
  const keyBytes = new TextEncoder().encode(key.padEnd(32, '0').substring(0, 32));
  return await aes256CbcDecryptAsync(keyBytes, hexToBytes(ivHex), hexToBytes(encrypted));
}

Deno.serve(async () => {
  const url = Deno.env.get('SUPABASE_URL');
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !srk) {
    return new Response(JSON.stringify({ error: 'Faltan variables de Supabase' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(url, srk);
  const limite = new Date(Date.now() - MINUTOS_COLGADO * 60 * 1000).toISOString();

  const { data: colgados, error: qErr } = await supabase
    .from('comprobante')
    .select('id, tenant_id, mp_point_intent_id, updated_at')
    .eq('estado', 'pendiente_posnet')
    .lt('updated_at', limite)
    .not('mp_point_intent_id', 'is', null);

  if (qErr) {
    console.error('[limpiar-intents-posnet]', qErr.message);
    return new Response(JSON.stringify({ error: qErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let liberados = 0;
  let errores = 0;

  for (const comp of colgados ?? []) {
    const intentId = comp.mp_point_intent_id?.trim();
    if (!intentId) continue;

    try {
      const { data: cfg, error: cfgErr } = await supabase
        .from('mp_point_config')
        .select('access_token, device_id')
        .eq('tenant_id', comp.tenant_id)
        .maybeSingle();

      if (cfgErr || !cfg?.access_token || !cfg.device_id?.trim()) {
        console.error('[limpiar-intents-posnet] sin config', comp.tenant_id, cfgErr?.message);
        errores++;
        continue;
      }

      let tokenPlain: string;
      try {
        tokenPlain = await desencriptarTokenMp(cfg.access_token.trim());
      } catch (e) {
        console.error('[limpiar-intents-posnet] decrypt', comp.id, e);
        errores++;
        continue;
      }

      const delUrl = `${MP_API}/devices/${encodeURIComponent(cfg.device_id.trim())}/payment-intents/${encodeURIComponent(intentId)}`;
      const mpRes = await fetch(delUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenPlain}`,
          'Content-Type': 'application/json',
        },
      });

      if (!mpRes.ok && mpRes.status !== 422 && mpRes.status !== 404) {
        console.error('[limpiar-intents-posnet] MP', comp.id, mpRes.status, await mpRes.text());
        errores++;
        continue;
      }

      const { error: upErr } = await supabase
        .from('comprobante')
        .update({
          estado: 'borrador' as never,
          mp_point_intent_id: null,
        })
        .eq('id', comp.id)
        .eq('tenant_id', comp.tenant_id);

      if (upErr) {
        console.error('[limpiar-intents-posnet] DB comprobante', comp.id, upErr.message);
        errores++;
        continue;
      }

      await supabase
        .from('mp_point_config')
        .update({ last_payment_intent_id: null })
        .eq('tenant_id', comp.tenant_id)
        .eq('last_payment_intent_id', intentId);

      liberados++;
      console.log('[limpiar-intents-posnet] liberado', comp.id);
    } catch (e) {
      console.error('[limpiar-intents-posnet] excepción', comp.id, e);
      errores++;
    }
  }

  return new Response(
    JSON.stringify({
      liberados,
      errores,
      revisados: colgados?.length ?? 0,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
