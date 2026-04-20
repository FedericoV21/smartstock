import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { getMpPointClient, MpPointError } from '@/lib/mp-point/client';
import { decryptAccessToken, loadMpPointConfig } from '@/lib/mp-point/load-config';
import { procesarNotificacionMpPointIntent } from '@/lib/mp-point/procesar-webhook';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { moduloGuard } from '@/lib/modulos/guard';

const ultimaConsultaPorComprobante = new Map<string, number>();
const RATE_MS = 5000;

export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const url = new URL(request.url);
  const comprobanteId = url.searchParams.get('comprobante_id')?.trim();
  if (!comprobanteId) {
    return NextResponse.json({ error: 'comprobante_id requerido' }, { status: 400 });
  }

  const now = Date.now();
  const prev = ultimaConsultaPorComprobante.get(comprobanteId) ?? 0;
  if (now - prev < RATE_MS) {
    return NextResponse.json(
      { error: 'Esperá unos segundos antes de volver a consultar' },
      { status: 429 },
    );
  }
  ultimaConsultaPorComprobante.set(comprobanteId, now);

  const { data: comp, error: cErr } = await session.supabase
    .from('comprobante')
    .select(
      'id, tenant_id, estado, mp_point_intent_id, mp_point_payment_id, metodo_pago',
    )
    .eq('id', comprobanteId)
    .maybeSingle();

  if (cErr || !comp || comp.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (!comp.mp_point_intent_id) {
    return NextResponse.json(
      { error: 'No hay cobro pendiente para este comprobante' },
      { status: 400 },
    );
  }

  const { data: cfg, error: cfgErr } = await loadMpPointConfig(session.supabase, session.tenantId);
  if (cfgErr || !cfg?.access_token || !cfg.device_id) {
    return NextResponse.json({ error: 'Configuración de MP Point incompleta' }, { status: 400 });
  }

  const tokenPlain = decryptAccessToken(cfg.access_token);
  if (!tokenPlain) {
    return NextResponse.json({ error: 'Configuración de MP Point incompleta' }, { status: 400 });
  }

  try {
    const client = getMpPointClient(tokenPlain);
    const intent = await client.getPaymentIntent(cfg.device_id, comp.mp_point_intent_id);
    const estadoNexus = comp.estado;
    const paymentType = intent.payment?.type;

    if (
      intent.state === 'FINISHED' &&
      intent.payment?.state === 'approved' &&
      comp.estado === 'pendiente_posnet' &&
      comp.mp_point_payment_id == null
    ) {
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const admin = createServiceRoleClient();
        await procesarNotificacionMpPointIntent(admin, { intentId: comp.mp_point_intent_id });
      }
    }

    return NextResponse.json({
      estado_mp: intent.state,
      estado_nexus: estadoNexus,
      payment_type: paymentType,
    });
  } catch (e) {
    if (e instanceof MpPointError) {
      return NextResponse.json(
        { error: e.message, mp_error_code: e.code },
        { status: e.status >= 500 ? 503 : 400 },
      );
    }
    console.error('[GET /api/pagos/mp-point/estado]', e);
    return NextResponse.json({ error: 'Error al consultar Mercado Pago' }, { status: 503 });
  }
}
