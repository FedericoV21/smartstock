import { NextResponse } from 'next/server';

import { procesarNotificacionMpPointIntent } from '@/lib/mp-point/procesar-webhook';
import { verifyMercadoPagoWebhookSignature } from '@/lib/mp-point/webhook-signature';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function extraerIntentId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const d = (body as Record<string, unknown>).data;
  if (d && typeof d === 'object' && (d as Record<string, unknown>).id != null) {
    return String((d as Record<string, unknown>).id);
  }
  return null;
}

export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const intentId = extraerIntentId(parsed);
  if (!intentId) {
    return NextResponse.json({ ok: true });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[mp-point webhook] SUPABASE_SERVICE_ROLE_KEY ausente');
    return NextResponse.json({ ok: true });
  }

  const admin = createServiceRoleClient();
  const { data: comp } = await admin
    .from('comprobante')
    .select('tenant_id, mp_point_intent_id')
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
    .maybeSingle();

  const secret = cfg?.webhook_secret?.trim();
  if (!secret) {
    console.error('[mp-point webhook] sin webhook_secret tenant', comp.tenant_id);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
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

  void procesarNotificacionMpPointIntent(admin, { intentId }).catch((e) => {
    console.error('[mp-point webhook] proceso async', e);
  });

  return NextResponse.json({ ok: true });
}
