import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { rejectUnlessProveedorEdicion } from '@/lib/api/permissions';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database, Tables } from '@/types/database';

type TipoPago = Database['public']['Enums']['tipo_pago'];

type ObligacionPagoBody = {
  id?: unknown;
  monto?: unknown;
};

type ObligacionPago = Pick<
  Tables<'pago_proveedor_factura'>,
  'id' | 'proveedor_id' | 'tenant_id' | 'monto_original' | 'saldo_pendiente' | 'estado' | 'vencimiento_at'
>;

function parseMonto(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function estadoObligacion(saldoPendiente: number, montoOriginal: number) {
  if (saldoPendiente <= 0.000001) return 'pagada';
  if (saldoPendiente + 0.000001 < montoOriginal) return 'parcial';
  return 'pendiente';
}

function fechaMasDiasIso(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString();
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const deniedProv = await rejectUnlessProveedorEdicion(session.supabase, session);
  if (deniedProv) return deniedProv;

  const { id: proveedorId } = await ctx.params;

  let body: {
    obligaciones?: ObligacionPagoBody[];
    tipo_pago?: TipoPago;
    notas?: string | null;
    fecha?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const obligacionesBody = Array.isArray(body.obligaciones) ? body.obligaciones : [];
  const ids = [
    ...new Set(
      obligacionesBody
        .map((o) => (typeof o?.id === 'string' ? o.id.trim() : ''))
        .filter((id) => id.length > 0),
    ),
  ];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Seleccioná al menos una factura' }, { status: 400 });
  }
  if (ids.length > 100) {
    return NextResponse.json({ error: 'No se pueden pagar más de 100 facturas juntas' }, { status: 400 });
  }

  let fechaP: string | null = null;
  if (body.fecha != null && String(body.fecha).trim() !== '') {
    const s = String(body.fecha).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return NextResponse.json({ error: 'fecha inválida (usá YYYY-MM-DD)' }, { status: 400 });
    }
    fechaP = s;
  }

  const { data: prov, error: provErr } = await session.supabase
    .from('proveedor')
    .select('id')
    .eq('id', proveedorId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (provErr || !prov) {
    return NextResponse.json(
      { error: provErr?.message ?? 'Proveedor no encontrado' },
      { status: provErr ? 500 : 404 },
    );
  }

  const { data: obligacionesRaw, error: obligacionesErr } = await session.supabase
    .from('pago_proveedor_factura')
    .select('id, proveedor_id, tenant_id, monto_original, saldo_pendiente, estado, vencimiento_at')
    .eq('tenant_id', session.tenantId)
    .eq('proveedor_id', proveedorId)
    .in('id', ids);

  if (obligacionesErr) {
    return NextResponse.json({ error: obligacionesErr.message }, { status: 500 });
  }

  const obligaciones = (obligacionesRaw ?? []) as ObligacionPago[];
  if (obligaciones.length !== ids.length) {
    return NextResponse.json({ error: 'Una o más facturas no pertenecen a este proveedor' }, { status: 400 });
  }

  const montoPorId = new Map(
    obligacionesBody
      .map((o) => [typeof o.id === 'string' ? o.id : '', parseMonto(o.monto)] as const)
      .filter(([id]) => id.length > 0),
  );

  const aplicaciones = obligaciones.map((o) => {
    const saldo = Number(o.saldo_pendiente);
    const montoSolicitado = montoPorId.get(o.id);
    const monto = montoSolicitado == null ? Math.round(saldo * 100) / 100 : montoSolicitado;
    return { obligacion: o, monto };
  });

  for (const app of aplicaciones) {
    const saldo = Number(app.obligacion.saldo_pendiente);
    if (app.obligacion.estado === 'anulada') {
      return NextResponse.json({ error: 'No se puede pagar una obligación anulada' }, { status: 400 });
    }
    if (!Number.isFinite(saldo) || saldo <= 0.000001) {
      return NextResponse.json({ error: 'Una de las facturas no tiene saldo pendiente' }, { status: 400 });
    }
    if (!Number.isFinite(app.monto) || app.monto <= 0) {
      return NextResponse.json({ error: 'Cada monto debe ser mayor a cero' }, { status: 400 });
    }
    if (app.monto > saldo + 0.000001) {
      return NextResponse.json(
        { error: 'El monto aplicado no puede superar el saldo de la factura' },
        { status: 400 },
      );
    }
  }

  const total = Math.round(aplicaciones.reduce((acc, app) => acc + app.monto, 0) * 100) / 100;
  if (total <= 0) {
    return NextResponse.json({ error: 'El monto total debe ser mayor a cero' }, { status: 400 });
  }

  const detalle = body.notas?.trim() || null;
  const tipoPago = body.tipo_pago ?? 'efectivo';
  const referencia = `Pago de ${aplicaciones.length} factura${aplicaciones.length === 1 ? '' : 's'}`;

  const { data: pago, error: pagoErr } = await session.supabase.rpc('registrar_pago_cuenta_proveedor', {
    p_tenant_id: session.tenantId,
    p_proveedor_id: proveedorId,
    p_monto: total,
    p_tipo_pago: tipoPago,
    p_comprobante_id: null,
    p_referencia: referencia,
    p_notas: detalle,
    p_usuario_id: session.userId,
    p_fecha: fechaP,
  });

  if (pagoErr || !pago) {
    return NextResponse.json({ error: pagoErr?.message ?? 'No se pudo registrar el pago' }, { status: 400 });
  }

  const movimientos = aplicaciones.map((app) => ({
    tenant_id: session.tenantId,
    pago_proveedor_factura_id: app.obligacion.id,
    pago_cuenta_corriente_id: pago.id,
    monto: app.monto,
    tipo_pago: tipoPago,
    ...(fechaP ? { fecha: fechaP } : {}),
    usuario_id: session.userId,
    notas: detalle,
  }));

  const { error: movErr } = await session.supabase.from('pago_proveedor_movimiento').insert(movimientos);
  if (movErr) {
    return NextResponse.json(
      { error: `Pago registrado, pero no se pudo vincular a las facturas: ${movErr.message}` },
      { status: 500 },
    );
  }

  const resultados: { id: string; monto_aplicado: number; nuevo_saldo: number }[] = [];
  for (const app of aplicaciones) {
    const saldoActual = Number(app.obligacion.saldo_pendiente);
    const montoOriginal = Number(app.obligacion.monto_original);
    const nuevoSaldo = Math.max(Math.round((saldoActual - app.monto) * 100) / 100, 0);
    const { error: updErr } = await session.supabase
      .from('pago_proveedor_factura')
      .update({
        saldo_pendiente: nuevoSaldo,
        estado: estadoObligacion(nuevoSaldo, montoOriginal),
        vencimiento_at: nuevoSaldo > 0 ? fechaMasDiasIso(7) : app.obligacion.vencimiento_at,
        recordatorio_snooze_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', session.tenantId)
      .eq('id', app.obligacion.id);

    if (updErr) {
      return NextResponse.json(
        { error: `Pago registrado, pero no se pudo actualizar una factura: ${updErr.message}` },
        { status: 500 },
      );
    }

    resultados.push({
      id: app.obligacion.id,
      monto_aplicado: app.monto,
      nuevo_saldo: nuevoSaldo,
    });
  }

  return NextResponse.json({
    resultado: {
      pago_id: pago.id,
      total_pagado: total,
      facturas: resultados,
    },
  });
}
