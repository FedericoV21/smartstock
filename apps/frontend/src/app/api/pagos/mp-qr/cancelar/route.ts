import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { broadcastMpQrEvent } from '@/lib/mp-qr/broadcast';
import { getMpQrClient, MpQrError } from '@/lib/mp-qr/client';
import { decryptMpQrAccessToken, loadMpQrConfig } from '@/lib/mp-qr/load-config';
import { resolveMpQrPos } from '@/lib/mp-qr/verificar-configuracion';
import { moduloGuard } from '@/lib/modulos/guard';
import { actualizarTransaccionPasarelaPorComprobante } from '@/lib/pasarelas/transacciones';

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: { comprobante_id?: string; liberar_qr?: boolean };
  try {
    body = (await request.json()) as { comprobante_id?: string; liberar_qr?: boolean };
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const comprobanteId = body.comprobante_id?.trim();
  if (!comprobanteId) {
    return NextResponse.json({ error: 'comprobante_id es obligatorio' }, { status: 400 });
  }

  const { data: comp, error: compErr } = await session.supabase
    .from('comprobante')
    .select('id, tenant_id, sucursal_id, estado, mp_qr_order_id')
    .eq('id', comprobanteId)
    .maybeSingle();

  if (compErr || !comp || comp.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (comp.estado !== 'pendiente_qr' && body.liberar_qr !== true) {
    return NextResponse.json({ error: 'El comprobante no está esperando pago QR' }, { status: 400 });
  }

  const { data: cfg, error: cfgErr } = await loadMpQrConfig(session.supabase, session.tenantId, comp.sucursal_id);
  if (cfgErr) {
    return NextResponse.json({ error: cfgErr }, { status: 500 });
  }
  if (!cfg?.access_token || !cfg.user_id?.trim() || !cfg.external_pos_id?.trim()) {
    return NextResponse.json({ error: 'Configuración de MP QR incompleta' }, { status: 400 });
  }

  const token = decryptMpQrAccessToken(cfg.access_token);
  if (!token) {
    return NextResponse.json({ error: 'Configuración de MP QR incompleta' }, { status: 400 });
  }

  const userId = cfg.user_id.trim();
  const resolvedPos = await resolveMpQrPos({
    access_token: token,
    user_id: userId,
    external_pos_id: cfg.external_pos_id.trim(),
  }).catch(() => ({
    external_pos_id: cfg.external_pos_id!.trim(),
    external_store_id: null,
    resolved_from_internal_id: false,
  }));
  const client = getMpQrClient(token, userId);
  try {
    await client.cancelOrder(resolvedPos.external_pos_id, {
      externalStoreId: resolvedPos.external_store_id,
      orderId: comp.mp_qr_order_id,
    });
  } catch (e) {
    if (
      e instanceof MpQrError &&
      (e.status === 404 ||
        e.code === 'in_store_order_delete_error' ||
        e.code === 'instore_order_locked_error' ||
        e.code === 'order_already_canceled')
    ) {
      /* idempotencia: orden ya liberada o no borrable en MP */
    } else if (e instanceof MpQrError) {
      console.error('[mp-qr cancelar] MP', e.status, e.code);
      const status =
        e.status === 401
          ? 400
          : e.status === 409 || e.code === 'in_store_order_delete_error' || e.code === 'instore_order_locked_error'
            ? 409
            : e.status >= 500
              ? 503
              : 503;
      return NextResponse.json({ error: e.message, mp_error_code: e.code }, { status });
    } else {
      console.error('[mp-qr cancelar]', e);
      return NextResponse.json({ error: 'No se pudo cancelar la orden QR en Mercado Pago' }, { status: 503 });
    }
  }

  const canceladoAt = new Date().toISOString();
  const { error: upErr } = await session.supabase
    .from('comprobante')
    .update({
      estado: 'borrador' as never,
      mp_qr_order_id: null,
      mp_qr_cancelado_at: canceladoAt,
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
    canal: 'qr',
    estado: 'cancelada',
  });

  try {
    await broadcastMpQrEvent(comprobanteId, { estado: 'cancelado', payment_type: 'qr' });
  } catch {
    /* noop */
  }

  return NextResponse.json({ mensaje: 'Cobro cancelado' });
}
