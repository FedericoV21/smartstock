import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { getPasarelaAdapter } from '@/lib/pasarelas/adapters';
import {
  insertarTransaccionPasarelaActiva,
  marcarTransaccionPasarela,
} from '@/lib/pasarelas/transacciones';
import type { PasarelaComprobantePago, PasarelaIntegracionRow } from '@/lib/pasarelas/types';

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
  );
}

function positiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
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

  const integracionId = typeof body.integracion_id === 'string' ? body.integracion_id.trim() : '';
  const comprobanteId = typeof body.comprobante_id === 'string' ? body.comprobante_id.trim() : '';
  const monto = positiveNumber(body.total);
  if (!integracionId || !comprobanteId || monto == null) {
    return NextResponse.json(
      { error: 'integracion_id, comprobante_id y total positivo son obligatorios' },
      { status: 400 },
    );
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

  const { data: integracion, error: intErr } = await db
    .from('pasarela_integracion')
    .select('*')
    .eq('id', integracionId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (intErr) return NextResponse.json({ error: intErr.message }, { status: 500 });
  if (!integracion) return NextResponse.json({ error: 'Integracion no encontrada' }, { status: 404 });
  if (integracion.estado !== 'activa') {
    return NextResponse.json({ error: 'La integracion no esta activa' }, { status: 400 });
  }
  if (String(integracion.sucursal_id) !== String(comp.sucursal_id)) {
    return NextResponse.json(
      { error: 'La integracion no pertenece a la sucursal del comprobante' },
      { status: 400 },
    );
  }

  const adapter = getPasarelaAdapter(String(integracion.tipo));
  if (!adapter) {
    return NextResponse.json(
      { error: `No hay adapter registrado para ${String(integracion.tipo)}` },
      { status: 400 },
    );
  }

  if (adapter.canal !== integracion.canal || adapter.proveedor !== integracion.proveedor) {
    return NextResponse.json({ error: 'Adapter e integracion no coinciden' }, { status: 400 });
  }

  if (comp.estado !== 'borrador' && !(integracion.tipo === 'mp_qr' && comp.estado === 'pendiente_qr')) {
    return NextResponse.json(
      { error: 'Solo se puede cobrar una pasarela sobre un borrador o un QR en curso.' },
      { status: 400 },
    );
  }

  const totalDb = positiveNumber(comp.total);
  if (totalDb == null) {
    return NextResponse.json({ error: 'El borrador no tiene un total valido para cobrar' }, { status: 400 });
  }
  if (Math.abs(Math.round(monto * 100) - Math.round(totalDb * 100)) > 2) {
    console.warn('[pasarela iniciar] total body distinto del borrador', {
      comprobante_id: comprobanteId,
      tenant_id: session.tenantId,
      total_en_body: monto,
      total_en_comprobante: totalDb,
    });
  }

  const cajaId = isUuid(comp.caja_id) ? comp.caja_id.trim() : null;
  if (!cajaId) {
    return NextResponse.json(
      { error: 'La venta necesita una caja abierta para usar pasarelas externas.' },
      { status: 400 },
    );
  }

  const { data: link, error: linkErr } = await db
    .from('pasarela_caja')
    .select('id, habilitado')
    .eq('tenant_id', session.tenantId)
    .eq('caja_id', cajaId)
    .eq('integracion_id', integracionId)
    .maybeSingle();
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
  if (!link?.habilitado) {
    return NextResponse.json(
      { error: 'La integracion no esta habilitada para esta caja.' },
      { status: 403 },
    );
  }

  const validation = adapter.validateConfig(integracion as PasarelaIntegracionRow);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  const tx = await insertarTransaccionPasarelaActiva(db, {
    tenant_id: session.tenantId,
    sucursal_id: String(comp.sucursal_id),
    caja_id: cajaId,
    integracion_id: integracionId,
    comprobante_id: comprobanteId,
    proveedor: String(integracion.proveedor),
    canal: integracion.canal,
    tipo: String(integracion.tipo),
    monto: totalDb,
    external_reference: comprobanteId,
  });
  if (!tx.ok) {
    return NextResponse.json({ error: tx.error, code: tx.code }, { status: tx.status });
  }

  const result = await adapter.createPayment({
    db,
    tenantId: session.tenantId,
    integracion: integracion as PasarelaIntegracionRow,
    comprobante: comp as PasarelaComprobantePago,
    monto: totalDb,
  });

  if (!result.ok) {
    await marcarTransaccionPasarela(db, tx.id, {
      estado: 'error',
      ultimo_error: result.error,
      request_payload: result.request_payload ?? null,
      response_payload:
        result.response_payload ??
        ({
          status: result.status,
          code: result.code ?? null,
          error: result.error,
        } as Record<string, unknown>),
    });
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }

  const { error: upErr } = await db
    .from('comprobante')
    .update(result.updateComprobante)
    .eq('id', comprobanteId)
    .eq('tenant_id', session.tenantId);
  if (upErr) {
    await marcarTransaccionPasarela(db, tx.id, {
      estado: 'error',
      ultimo_error: upErr.message ?? 'No se pudo guardar el estado del comprobante',
    });
    try {
      await adapter.cancelPayment?.({
        db,
        tenantId: session.tenantId,
        integracion: integracion as PasarelaIntegracionRow,
        comprobante: {
          ...(comp as PasarelaComprobantePago),
          ...result.updateComprobante,
        },
      });
    } catch {
      /* cancelar es best-effort */
    }
    return NextResponse.json({ error: 'No se pudo guardar el estado del comprobante' }, { status: 500 });
  }

  await marcarTransaccionPasarela(db, tx.id, {
    estado: result.transaccion.estado,
    external_intent_id: result.transaccion.external_intent_id ?? null,
    external_order_id: result.transaccion.external_order_id ?? null,
    external_reference: result.transaccion.external_reference ?? null,
    request_payload: result.transaccion.request_payload ?? null,
    response_payload: result.transaccion.response_payload ?? null,
  });

  return NextResponse.json({
    ...result.response,
    transaccion_id: tx.id,
    pasarela_integracion_id: integracionId,
  });
}
