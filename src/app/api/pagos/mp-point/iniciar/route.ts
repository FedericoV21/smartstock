import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { getMpPointClient, MpPointError } from '@/lib/mp-point/client';
import { decryptAccessToken, loadMpPointConfig } from '@/lib/mp-point/load-config';
import { moduloGuard } from '@/lib/modulos/guard';

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: { comprobante_id?: string; total?: number };
  try {
    body = (await request.json()) as { comprobante_id?: string; total?: number };
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const comprobanteId = body.comprobante_id?.trim();
  const total = body.total;
  if (!comprobanteId || total == null || !Number.isFinite(total) || total <= 0) {
    return NextResponse.json(
      { error: 'comprobante_id y total positivo son obligatorios' },
      { status: 400 },
    );
  }

  const { data: cfg, error: cfgErr } = await loadMpPointConfig(session.supabase, session.tenantId);
  if (cfgErr) {
    return NextResponse.json({ error: cfgErr }, { status: 500 });
  }
  if (!cfg?.habilitado || !cfg.device_id || !cfg.access_token) {
    return NextResponse.json(
      { error: 'Configuración de MP Point incompleta' },
      { status: 400 },
    );
  }

  const tokenPlain = decryptAccessToken(cfg.access_token);
  if (!tokenPlain) {
    return NextResponse.json(
      { error: 'Configuración de MP Point incompleta' },
      { status: 400 },
    );
  }

  const { data: comp, error: compErr } = await session.supabase
    .from('comprobante')
    .select(
      'id, tenant_id, estado, mp_point_intent_id, metodo_pago, total',
    )
    .eq('id', comprobanteId)
    .maybeSingle();

  if (compErr || !comp || comp.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (comp.estado !== 'borrador') {
    return NextResponse.json(
      {
        error:
          'Solo se puede cobrar con terminal sobre un comprobante en borrador (creá la venta como borrador antes de cobrar).',
      },
      { status: 400 },
    );
  }

  const cents = Math.round(total * 100);
  const client = getMpPointClient(tokenPlain);
  const deviceId = cfg.device_id;

  if (comp.mp_point_intent_id) {
    try {
      const prev = await client.getPaymentIntent(deviceId, comp.mp_point_intent_id);
      if (prev.state === 'OPEN' || prev.state === 'ON_TERMINAL' || prev.state === 'PROCESSING') {
        await client.cancelPaymentIntent(deviceId, comp.mp_point_intent_id);
      }
    } catch (e) {
      if (e instanceof MpPointError && (e.status === 422 || e.status === 404)) {
        /* ya terminado o inexistente */
      } else if (e instanceof MpPointError) {
        console.error('[mp-point iniciar] cancel prev intent', e.status, e.code);
      }
    }
  }

  try {
    const checkDevice = await client.listDevices();
    const dev = checkDevice.find((d) => d.id === deviceId);
    if (dev && dev.operating_mode === 'STANDALONE') {
      return NextResponse.json(
        {
          error:
            'La terminal está en modo autónomo (STANDALONE). Cambiala a modo PDV desde la app de Mercado Pago.',
          mp_error_code: 'standalone_mode',
        },
        { status: 400 },
      );
    }

    const intent = await client.createPaymentIntent(deviceId, {
      amount: cents,
      additional_info: {
        external_reference: comprobanteId,
        print_on_terminal: true,
      },
    });

    console.info('[mp-point iniciar]', { comprobante_id: comprobanteId, intent_id: intent.id });

    const { error: upErr } = await session.supabase
      .from('comprobante')
      .update({
        mp_point_intent_id: intent.id,
        estado: 'pendiente_posnet' as never,
      })
      .eq('id', comprobanteId)
      .eq('tenant_id', session.tenantId);

    if (upErr) {
      console.error('[mp-point iniciar] DB', upErr);
      try {
        await client.cancelPaymentIntent(deviceId, intent.id);
      } catch {
        /* noop */
      }
      return NextResponse.json({ error: 'No se pudo guardar el intent' }, { status: 500 });
    }

    return NextResponse.json({
      intent_id: intent.id,
      estado: 'pendiente_posnet',
    });
  } catch (e) {
    if (e instanceof MpPointError) {
      if (e.status === 401) {
        return NextResponse.json({ error: 'Token de MP inválido o vencido' }, { status: 400 });
      }
      const st = e.status >= 500 ? 503 : e.status === 422 ? 400 : 503;
      return NextResponse.json(
        {
          error: e.message || 'Error de Mercado Pago Point',
          mp_error_code: e.code,
        },
        { status: st },
      );
    }
    console.error('[mp-point iniciar]', e);
    return NextResponse.json({ error: 'Error al crear el cobro en la terminal' }, { status: 503 });
  }
}
