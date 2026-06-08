import { after, NextResponse } from 'next/server';

import { procesarNotificacionMpPointIntent } from '@/lib/mp-point/procesar-webhook';
import {
  procesarNotificacionMpQrMerchantOrder,
  procesarNotificacionMpQrPayment,
} from '@/lib/mp-qr/procesar-webhook';
import { getPasarelaAdapter } from '@/lib/pasarelas/adapters';
import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { PasarelaIntegracionRow } from '@/lib/pasarelas/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteParams = { params: Promise<{ proveedor: string; webhook_public_id: string }> };

function normalizar(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function extraerIntentId(url: URL, body: unknown): string | null {
  const q = normalizar(url.searchParams.get('data.id'));
  if (q) return q;
  if (!body || typeof body !== 'object') return null;
  const d = (body as Record<string, unknown>).data;
  if (d && typeof d === 'object' && (d as Record<string, unknown>).id != null) {
    return normalizar(String((d as Record<string, unknown>).id));
  }
  return null;
}

function extraerPaymentId(url: URL, body: unknown): string | null {
  const topic = extraerTopic(url, body);
  if (topic !== 'payment') return null;
  return extraerMerchantOrderId(url, body);
}

function extraerMerchantOrderId(url: URL, body: unknown): string | null {
  const q = normalizar(url.searchParams.get('data.id')) ?? normalizar(url.searchParams.get('id'));
  if (q) return q;
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const d = b.data;
  if (d && typeof d === 'object' && (d as Record<string, unknown>).id != null) {
    return normalizar(String((d as Record<string, unknown>).id));
  }
  if (b.id != null) return normalizar(String(b.id));
  const resource = b.resource;
  if (typeof resource === 'string' && resource.includes('merchant_orders')) {
    const last = resource.split('/').filter(Boolean).at(-1);
    return normalizar(last?.split('?')[0]);
  }
  return null;
}

function extraerTopic(url: URL, body: unknown): string | null {
  const q = normalizar(url.searchParams.get('topic'))?.toLowerCase();
  if (q) return q;
  if (body && typeof body === 'object') {
    const type = (body as Record<string, unknown>).type;
    if (typeof type === 'string') return normalizar(type)?.toLowerCase() ?? null;
  }
  return null;
}

function headersParaLog(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    const k = key.toLowerCase();
    if (k.startsWith('x-') || k === 'user-agent') out[k] = value.slice(0, 500);
  }
  return out;
}

async function marcarWebhookProcesado(db: any, logId: string | null, patch: Record<string, unknown>) {
  if (!logId) return;
  const { error } = await db.from('pasarela_webhook_log').update(patch).eq('id', logId);
  if (error) console.error('[pasarelas webhook] update log', error.message ?? error);
}

export async function POST(request: Request, ctx: RouteParams) {
  const { proveedor: proveedorRaw, webhook_public_id: webhookPublicIdRaw } = await ctx.params;
  const proveedor = normalizar(proveedorRaw)?.toLowerCase();
  const webhookPublicId = normalizar(webhookPublicIdRaw);

  if (!proveedor || !webhookPublicId) {
    return NextResponse.json({ error: 'webhook invalido' }, { status: 400 });
  }

  if (!getSupabaseServiceRoleKey()) {
    console.error('[pasarelas webhook] service role ausente');
    return NextResponse.json({ error: 'Service role no configurada' }, { status: 503 });
  }

  const url = new URL(request.url);
  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Body invalido' }, { status: 400 });
  }

  let parsed: unknown = null;
  if (rawBody.trim()) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = null;
    }
  }

  const admin = createServiceRoleClient() as any;
  const { data: integracion, error: intErr } = await admin
    .from('pasarela_integracion')
    .select('*')
    .eq('proveedor', proveedor)
    .eq('webhook_public_id', webhookPublicId)
    .maybeSingle();

  if (intErr) return NextResponse.json({ error: intErr.message }, { status: 500 });
  if (!integracion) return NextResponse.json({ error: 'Integracion no encontrada' }, { status: 404 });

  const adapter = getPasarelaAdapter(String(integracion.tipo));
  if (!adapter) return NextResponse.json({ ok: true, ignored: true });

  if (adapter.verifyWebhook) {
    const ok = await adapter.verifyWebhook({
      integracion: integracion as PasarelaIntegracionRow,
      rawBody,
      bodyJson: parsed,
      headers: request.headers,
      url,
    });
    if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const topic = extraerTopic(url, parsed);
  const eventId =
    integracion.tipo === 'mp_point'
      ? extraerIntentId(url, parsed)
      : integracion.tipo === 'mp_qr'
        ? topic === 'payment'
          ? extraerPaymentId(url, parsed)
          : extraerMerchantOrderId(url, parsed)
        : null;

  const { data: logRow, error: logErr } = await admin
    .from('pasarela_webhook_log')
    .insert({
      tenant_id: integracion.tenant_id,
      integracion_id: integracion.id,
      proveedor,
      webhook_public_id: webhookPublicId,
      event_id: eventId,
      topic,
      payload_snippet: rawBody.slice(0, 2000),
      headers: headersParaLog(request.headers),
      resultado: 'recibido',
    })
    .select('id')
    .maybeSingle();
  if (logErr && logErr.code !== '23505') {
    console.error('[pasarelas webhook] insert log', logErr.message ?? logErr);
  }
  const logId = logRow?.id ? String(logRow.id) : null;

  if (integracion.tipo === 'mp_point') {
    const intentId = extraerIntentId(url, parsed);
    if (!intentId) {
      await marcarWebhookProcesado(admin, logId, {
        procesado: true,
        resultado: 'ignorado_sin_intent',
      });
      return NextResponse.json({ ok: true });
    }
    after(async () => {
      try {
        await procesarNotificacionMpPointIntent(createServiceRoleClient(), { intentId });
        await marcarWebhookProcesado(createServiceRoleClient() as any, logId, {
          procesado: true,
          resultado: 'procesado',
        });
      } catch (e) {
        console.error('[pasarelas/mp-point webhook] proceso', e);
        await marcarWebhookProcesado(createServiceRoleClient() as any, logId, {
          procesado: false,
          resultado: 'error',
          error_mensaje: String(e),
        });
      }
    });
    return NextResponse.json({ ok: true });
  }

  if (integracion.tipo === 'mp_qr') {
    if (topic === 'payment') {
      const paymentId = extraerPaymentId(url, parsed);
      if (!paymentId) {
        await marcarWebhookProcesado(admin, logId, {
          procesado: true,
          resultado: 'ignorado_payment_sin_id',
        });
        return NextResponse.json({ ok: true });
      }
      after(async () => {
        try {
          await procesarNotificacionMpQrPayment(createServiceRoleClient(), {
            paymentId,
            tenantId: String(integracion.tenant_id),
            sucursalId: String(integracion.sucursal_id),
            integracionId: String(integracion.id),
          });
          await marcarWebhookProcesado(createServiceRoleClient() as any, logId, {
            procesado: true,
            resultado: 'procesado_payment',
          });
        } catch (e) {
          console.error('[pasarelas/mp-qr webhook] payment', e);
          await marcarWebhookProcesado(createServiceRoleClient() as any, logId, {
            procesado: false,
            resultado: 'error',
            error_mensaje: String(e),
          });
        }
      });
      return NextResponse.json({ ok: true });
    }
    if (topic !== 'merchant_order' && topic !== 'topic_merchant_order_wh') {
      await marcarWebhookProcesado(admin, logId, {
        procesado: true,
        resultado: 'ignorado_topic',
      });
      return NextResponse.json({ ok: true });
    }
    const merchantOrderId = extraerMerchantOrderId(url, parsed);
    if (!merchantOrderId) {
      await marcarWebhookProcesado(admin, logId, {
        procesado: true,
        resultado: 'ignorado_sin_merchant_order',
      });
      return NextResponse.json({ ok: true });
    }
    after(async () => {
      try {
        await procesarNotificacionMpQrMerchantOrder(createServiceRoleClient(), {
          merchantOrderId,
          tenantId: String(integracion.tenant_id),
          sucursalId: String(integracion.sucursal_id),
          integracionId: String(integracion.id),
        });
        await marcarWebhookProcesado(createServiceRoleClient() as any, logId, {
          procesado: true,
          resultado: 'procesado',
        });
      } catch (e) {
        console.error('[pasarelas/mp-qr webhook] proceso', e);
        await marcarWebhookProcesado(createServiceRoleClient() as any, logId, {
          procesado: false,
          resultado: 'error',
          error_mensaje: String(e),
        });
      }
    });
    return NextResponse.json({ ok: true });
  }

  await marcarWebhookProcesado(admin, logId, {
    procesado: true,
    resultado: 'ignorado_adapter_sin_proceso',
  });
  return NextResponse.json({ ok: true, ignored: true });
}
