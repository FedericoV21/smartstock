import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { broadcastMpPointEvent } from '@/lib/mp-point/broadcast';
import { getMpPointClient, MpPointError } from '@/lib/mp-point/client';
import { decryptAccessToken, loadMpPointConfig } from '@/lib/mp-point/load-config';
import { moduloGuard } from '@/lib/modulos/guard';
import { actualizarTransaccionPasarelaPorComprobante } from '@/lib/pasarelas/transacciones';

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: { comprobante_id?: string };
  try {
    body = (await request.json()) as { comprobante_id?: string };
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const comprobanteId = body.comprobante_id?.trim();
  if (!comprobanteId) {
    return NextResponse.json({ error: 'comprobante_id es obligatorio' }, { status: 400 });
  }

  const { data: comp, error: compErr } = await session.supabase
    .from('comprobante')
    .select('id, tenant_id, sucursal_id, estado, mp_point_intent_id')
    .eq('id', comprobanteId)
    .maybeSingle();

  if (compErr || !comp || comp.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (comp.estado !== 'pendiente_posnet' || !comp.mp_point_intent_id) {
    return NextResponse.json(
      { error: 'No hay cobro pendiente en terminal para este comprobante' },
      { status: 400 },
    );
  }

  const { data: cfg, error: cfgErr } = await loadMpPointConfig(session.supabase, session.tenantId, comp.sucursal_id);
  if (cfgErr) {
    return NextResponse.json({ error: cfgErr }, { status: 500 });
  }
  if (!cfg?.device_id || !cfg.access_token) {
    return NextResponse.json({ error: 'Configuración de MP Point incompleta' }, { status: 400 });
  }

  const tokenPlain = decryptAccessToken(cfg.access_token);
  if (!tokenPlain) {
    return NextResponse.json({ error: 'Configuración de MP Point incompleta' }, { status: 400 });
  }

  const client = getMpPointClient(tokenPlain);
  const deviceId = cfg.device_id;
  const intentId = comp.mp_point_intent_id;

  try {
    await client.cancelPaymentIntent(deviceId, intentId);
  } catch (e) {
    if (e instanceof MpPointError) {
      if (e.status === 422 || e.status === 404) {
        /* idempotencia: ya cancelado o no existe */
      } else if (e.status === 409) {
        return NextResponse.json(
          { error: 'El pago ya está siendo procesado' },
          { status: 409 },
        );
      } else {
        return NextResponse.json(
          { error: e.message, mp_error_code: e.code },
          { status: e.status >= 500 ? 503 : 400 },
        );
      }
    } else {
      console.error('[mp-point cancelar]', e);
      return NextResponse.json({ error: 'Error al cancelar en Mercado Pago' }, { status: 503 });
    }
  }

  const { error: upErr } = await session.supabase
    .from('comprobante')
    .update({
      estado: 'borrador' as never,
      mp_point_intent_id: null,
    })
    .eq('id', comprobanteId)
    .eq('tenant_id', session.tenantId);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  await actualizarTransaccionPasarelaPorComprobante(session.supabase as any, {
    tenantId: session.tenantId,
    comprobanteId,
    proveedor: 'mercado_pago',
    canal: 'terminal',
    estado: 'cancelada',
    externalIntentId: intentId,
  });

  void broadcastMpPointEvent(comprobanteId, { estado: 'cancelado' }).catch(() => {});

  return NextResponse.json({ mensaje: 'Cobro cancelado' });
}
