import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { broadcastMpPointEvent } from '@/lib/mp-point/broadcast';
import { broadcastMpQrEvent } from '@/lib/mp-qr/broadcast';
import { moduloGuard } from '@/lib/modulos/guard';
import { getPasarelaAdapter } from '@/lib/pasarelas/adapters';
import {
  PASARELA_TRANSACCION_ESTADOS_ACTIVOS,
  marcarTransaccionPasarela,
} from '@/lib/pasarelas/transacciones';
import type { PasarelaComprobantePago, PasarelaIntegracionRow } from '@/lib/pasarelas/types';

async function resolverCobroActivo(db: any, params: {
  tenantId: string;
  comprobanteId: string;
  integracionId?: string | null;
}) {
  let q = db
    .from('pasarela_transaccion')
    .select('*')
    .eq('tenant_id', params.tenantId)
    .eq('comprobante_id', params.comprobanteId)
    .in('estado', PASARELA_TRANSACCION_ESTADOS_ACTIVOS)
    .order('created_at', { ascending: false })
    .limit(1);
  if (params.integracionId) q = q.eq('integracion_id', params.integracionId);
  return q.maybeSingle();
}

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const comprobanteId = typeof body.comprobante_id === 'string' ? body.comprobante_id.trim() : '';
  const integracionId = typeof body.integracion_id === 'string' ? body.integracion_id.trim() : '';
  const liberarQr = body.liberar_qr === true;
  if (!comprobanteId) {
    return NextResponse.json({ error: 'comprobante_id es obligatorio' }, { status: 400 });
  }

  const db = session.supabase as any;
  const { data: comp, error: compErr } = await db
    .from('comprobante')
    .select('id, tenant_id, sucursal_id, estado, total, numero_orden, mp_point_intent_id, mp_qr_order_id, caja_id')
    .eq('id', comprobanteId)
    .maybeSingle();
  if (compErr || !comp || comp.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  const { data: tx, error: txErr } = await resolverCobroActivo(db, {
    tenantId: session.tenantId,
    comprobanteId,
    integracionId: integracionId || null,
  });
  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });
  if (!tx) {
    if (!liberarQr || !integracionId) {
      return NextResponse.json({ error: 'No hay cobro activo de pasarela para cancelar' }, { status: 400 });
    }

    const { data: integracionLibre, error: iLibreErr } = await db
      .from('pasarela_integracion')
      .select('*')
      .eq('id', integracionId)
      .eq('tenant_id', session.tenantId)
      .maybeSingle();
    if (iLibreErr) return NextResponse.json({ error: iLibreErr.message }, { status: 500 });
    if (!integracionLibre) return NextResponse.json({ error: 'Integracion no encontrada' }, { status: 404 });
    if (String(integracionLibre.sucursal_id) !== String(comp.sucursal_id)) {
      return NextResponse.json(
        { error: 'La integracion no pertenece a la sucursal del comprobante' },
        { status: 400 },
      );
    }

    const adapterLibre = getPasarelaAdapter(String(integracionLibre.tipo));
    if (adapterLibre?.canal !== 'qr' || !adapterLibre.cancelPayment) {
      return NextResponse.json({ error: 'La pasarela QR no soporta cancelacion' }, { status: 400 });
    }

    const cancelLibre = await adapterLibre.cancelPayment({
      db,
      tenantId: session.tenantId,
      integracion: integracionLibre as PasarelaIntegracionRow,
      comprobante: comp as PasarelaComprobantePago,
    });
    if (!cancelLibre.ok) {
      return NextResponse.json({ error: cancelLibre.error }, { status: cancelLibre.status });
    }

    const { error: upLibreErr } = await db
      .from('comprobante')
      .update({
        estado: 'borrador' as never,
        mp_qr_order_id: null,
        mp_qr_cancelado_at: new Date().toISOString(),
      })
      .eq('id', comprobanteId)
      .eq('tenant_id', session.tenantId);
    if (upLibreErr) return NextResponse.json({ error: upLibreErr.message }, { status: 500 });

    void broadcastMpQrEvent(comprobanteId, { estado: 'cancelado', payment_type: 'qr' }).catch(() => {});
    return NextResponse.json({ mensaje: 'Cobro QR cancelado' });
  }

  const { data: integracion, error: iErr } = await db
    .from('pasarela_integracion')
    .select('*')
    .eq('id', tx.integracion_id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  if (!integracion) return NextResponse.json({ error: 'Integracion no encontrada' }, { status: 404 });

  const adapter = getPasarelaAdapter(String(integracion.tipo));
  if (!adapter?.cancelPayment) {
    return NextResponse.json({ error: 'La pasarela no soporta cancelacion' }, { status: 400 });
  }

  const cancel = await adapter.cancelPayment({
    db,
    tenantId: session.tenantId,
    integracion: integracion as PasarelaIntegracionRow,
    comprobante: {
      ...(comp as PasarelaComprobantePago),
      mp_qr_order_id: comp.mp_qr_order_id ?? tx.external_order_id ?? null,
    },
  });
  if (!cancel.ok) return NextResponse.json({ error: cancel.error }, { status: cancel.status });

  const patch =
    String(integracion.canal) === 'terminal'
      ? {
          estado: 'borrador' as never,
          mp_point_intent_id: null,
        }
      : {
          estado: 'borrador' as never,
          mp_qr_order_id: null,
          mp_qr_cancelado_at: new Date().toISOString(),
        };

  const { error: upErr } = await db
    .from('comprobante')
    .update(patch)
    .eq('id', comprobanteId)
    .eq('tenant_id', session.tenantId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await marcarTransaccionPasarela(db, String(tx.id), {
    estado: 'cancelada',
    ultimo_error: null,
  });

  if (String(integracion.canal) === 'terminal') {
    void broadcastMpPointEvent(comprobanteId, { estado: 'cancelado' }).catch(() => {});
  } else {
    void broadcastMpQrEvent(comprobanteId, { estado: 'cancelado', payment_type: 'qr' }).catch(() => {});
  }

  return NextResponse.json({ mensaje: 'Cobro cancelado' });
}
