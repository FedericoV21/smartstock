// src/app/api/pagos/mp-qr/webhook/route.ts
import { after, NextResponse } from 'next/server';

import {
  procesarNotificacionMpQrMerchantOrder,
  procesarNotificacionMpQrPayment,
} from '@/lib/mp-qr/procesar-webhook';
import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Webhook público de Mercado Pago para integraciones QR Code (MP-QR).
 *
 * IMPORTANTE: La documentación oficial de Mercado Pago indica que las
 * notificaciones de QR Code NO incluyen firma `x-signature`. Cita textual
 * de la doc oficial:
 *
 *   "Configuration through Your integrations: validating the notification
 *    origin using the secret signature (except notifications for QR Code
 *    integrations)."
 *
 * La validación de autenticidad se hace consultando el merchant_order a
 * la API de MP con el access_token del tenant. Esa consulta vive dentro
 * de procesarNotificacionMpQrMerchantOrder (client.getMerchantOrder):
 * si MP responde 200, la notificación es legítima; si responde 404/401,
 * el handler la descarta silenciosamente.
 *
 * Topics:
 *   - merchant_order → procesar
 *   - payment        → ignorar (los pagos llegan referenciados desde el merchant_order)
 *   - otros          → ignorar
 *
 * Política de respuesta: 200 siempre que se pueda. Cualquier !=200 hace
 * que MP reintente con backoff exponencial durante días.
 */

function extraerMerchantOrderId(url: URL, body: unknown): string | null {
  const q = url.searchParams.get('data.id')?.trim() || url.searchParams.get('id')?.trim();
  if (q) return q;
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const d = b.data;
  if (d && typeof d === 'object' && (d as Record<string, unknown>).id != null) {
    return String((d as Record<string, unknown>).id).trim() || null;
  }
  if (b.id != null) return String(b.id).trim() || null;
  const resource = b.resource;
  if (typeof resource === 'string' && resource.includes('merchant_orders')) {
    const seg = resource.split('/').filter(Boolean);
    const last = seg[seg.length - 1];
    if (last) return last.split('?')[0].trim() || null;
  }
  return null;
}

function extraerTopic(url: URL, body: unknown): string | null {
  const t = url.searchParams.get('topic')?.trim().toLowerCase();
  if (t) return t;
  if (body && typeof body === 'object') {
    const type = (body as Record<string, unknown>).type;
    if (typeof type === 'string') return type.trim().toLowerCase();
  }
  return null;
}

export async function POST(request: Request) {
  const url = new URL(request.url);

  // 1) Leer body crudo (puede venir vacío en notificaciones legacy)
  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    console.warn('[mp-qr webhook] body ilegible');
    return NextResponse.json({ ok: true });
  }

  let parsed: unknown = null;
  if (rawBody.trim()) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      console.warn('[mp-qr webhook] body no es JSON', rawBody.slice(0, 200));
    }
  }

  const topic = extraerTopic(url, parsed);
  if (topic === 'payment') {
    const paymentId =
      url.searchParams.get('data.id')?.trim() ||
      (parsed &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).data &&
      typeof (parsed as Record<string, unknown>).data === 'object'
        ? String(((parsed as Record<string, unknown>).data as Record<string, unknown>).id ?? '').trim()
        : '');
    if (!paymentId) {
      return NextResponse.json({ ok: true });
    }
    const tenantId = url.searchParams.get('tenant_id')?.trim();
    if (!tenantId || !getSupabaseServiceRoleKey()) {
      return NextResponse.json({ ok: true });
    }
    const sucursalId = url.searchParams.get('sucursal_id')?.trim() || null;
    after(async () => {
      try {
        await procesarNotificacionMpQrPayment(createServiceRoleClient(), {
          paymentId,
          tenantId,
          sucursalId,
        });
      } catch (e) {
        console.error('[mp-qr webhook] payment (after)', e);
      }
    });
    return NextResponse.json({ ok: true });
  }
  if (topic !== 'merchant_order' && topic !== 'topic_merchant_order_wh') {
    console.info('[mp-qr webhook] topic ignorado', { topic });
    return NextResponse.json({ ok: true });
  }

  // 3) Extraer identificadores
  const merchantOrderId = extraerMerchantOrderId(url, parsed);
  const tenantId = url.searchParams.get('tenant_id')?.trim();
  const sucursalId = url.searchParams.get('sucursal_id')?.trim() || null;

  if (!merchantOrderId) {
    console.warn('[mp-qr webhook] sin merchant_order_id', { url: url.toString() });
    return NextResponse.json({ ok: true });
  }

  if (!tenantId) {
    // 400 acá sí: indica que la URL del webhook se registró sin ?tenant_id=...
    // Es un error de configuración del integrador, no de MP.
    console.error('[mp-qr webhook] tenant_id ausente en query');
    return NextResponse.json(
      { error: 'tenant_id requerido en la URL del webhook' },
      { status: 400 },
    );
  }

  if (!getSupabaseServiceRoleKey()) {
    console.error('[mp-qr webhook] service role key ausente');
    return NextResponse.json({ error: 'Service role no configurada' }, { status: 503 });
  }

  // 4) Log de recepción (no bloqueante)
  const admin = createServiceRoleClient();
  void admin
    .from('mp_qr_webhook_log')
    .insert({
      tenant_id: tenantId,
      topic,
      merchant_order_id: merchantOrderId,
      resultado: 'recibido',
      payload_snippet: rawBody.slice(0, 2000),
    })
    .then(({ error }) => {
      if (error) console.error('[mp-qr webhook] log insert', error);
    });

  // 5) Procesamiento async — la validación de autenticidad ocurre adentro
  //    al consultar merchant_orders/{id} con el access_token del tenant.
  after(async () => {
    try {
      await procesarNotificacionMpQrMerchantOrder(createServiceRoleClient(), {
        merchantOrderId,
        tenantId,
        sucursalId,
      });
    } catch (e) {
      console.error('[mp-qr webhook] proceso (after)', e);
    }
  });

  return NextResponse.json({ ok: true });
}