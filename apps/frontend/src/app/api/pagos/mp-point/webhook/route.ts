import { after, NextResponse } from 'next/server';

import { auditLogPosnet } from '@/lib/mp-point/audit-log';
import { procesarNotificacionMpPointIntent } from '@/lib/mp-point/procesar-webhook';
import { verifyMercadoPagoWebhookSignature } from '@/lib/mp-point/webhook-signature';
import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function extraerIntentIdDesdeBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const d = (body as Record<string, unknown>).data;
  if (d && typeof d === 'object' && (d as Record<string, unknown>).id != null) {
    return String((d as Record<string, unknown>).id);
  }
  return null;
}

function normalizarIntentId(id: string | null | undefined): string | null {
  const t = id?.trim();
  return t ? t : null;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  /** MP envía el intent en `?data.id=...`; el body suele ir vacío o sin `data.id`. */
  const dataIdQuery = normalizarIntentId(url.searchParams.get('data.id'));

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  let parsed: unknown = null;
  if (rawBody?.trim()) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }
  }

  const intentId = dataIdQuery ?? extraerIntentIdDesdeBody(parsed);

  if (!intentId) {
    console.warn('[mp-point webhook] sin intent id en query data.id ni en body');
    return NextResponse.json({ ok: true });
  }

  if (!getSupabaseServiceRoleKey()) {
    console.error('[mp-point webhook] SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY ausente');
    return NextResponse.json(
      { error: 'Service role key no configurada (requerida para procesar el webhook)' },
      { status: 503 },
    );
  }

  const admin = createServiceRoleClient();
  const { data: comp } = await admin
    .from('comprobante')
    .select('tenant_id, sucursal_id, mp_point_intent_id')
    .eq('mp_point_intent_id', intentId)
    .maybeSingle();

  if (!comp) {
    console.warn('[mp-point webhook] intent sin comprobante local', intentId);
    return NextResponse.json({ ok: true });
  }

  const { data: cfg } = await admin
    .from('mp_point_config')
    .select('webhook_secret')
    .eq('tenant_id', comp.tenant_id)
    .eq('sucursal_id', comp.sucursal_id)
    .maybeSingle();

  const secret = cfg?.webhook_secret?.trim();
  if (!secret) {
    console.error('[mp-point webhook] sin webhook_secret tenant', comp.tenant_id);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const queryDataId = url.searchParams.get('data.id');

  const okSig = verifyMercadoPagoWebhookSignature({
    rawBody,
    bodyJson: parsed,
    xSignature: request.headers.get('x-signature'),
    xRequestId: request.headers.get('x-request-id'),
    queryDataId,
    secret,
  });

  if (!okSig) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  /**
   * Respuesta 200 inmediata para MP; el trabajo (GET intent + emitir) corre después del response
   * vía `after()` (soportado en Next/Vercel) para no cortar en serverless.
   */
  after(async () => {
    try {
      auditLogPosnet('webhook_http_after_inicio', { intentId });
      await procesarNotificacionMpPointIntent(createServiceRoleClient(), { intentId });
    } catch (e) {
      console.error('[mp-point webhook] proceso (after)', e);
      auditLogPosnet('webhook_http_after_error', { intentId, error: String(e) });
    }
  });

  return NextResponse.json({ ok: true });
}

/** Límite de duración (segundos) en plataformas que lo soportan (Vercel). */
export const maxDuration = 60;
