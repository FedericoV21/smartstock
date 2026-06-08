import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { rejectUnlessAccesoClientesApi, rejectUnlessClienteEdicion } from '@/lib/api/permissions';
import {
  applyCondicionesCuentaPatch,
  CUENTA_CORRIENTE_CONDICIONES_DEFAULTS,
  pickCondicionesKeys,
} from '@/lib/cuenta-corriente/condiciones-patch';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const deniedCli = await rejectUnlessAccesoClientesApi(session.supabase, session);
  if (deniedCli) return deniedCli;

  const { id: clienteId } = await params;

  const { data: cliente, error: clienteErr } = await session.supabase
    .from('cliente')
    .select('id')
    .eq('id', clienteId)
    .maybeSingle();

  if (clienteErr) {
    return NextResponse.json({ error: clienteErr.message }, { status: 500 });
  }
  if (!cliente) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  }

  const { data: cuenta, error } = await session.supabase
    .from('cuenta_corriente')
    .select(
      'id, tipo_cuenta, cobro_modalidad, cobro_dias_plazo, cobro_periodicidad, cobro_dia_vencimiento_mes, cobro_monto_minimo, saldo, limite_credito',
    )
    .eq('cliente_id', clienteId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ cuenta: cuenta ?? null });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const deniedCli = await rejectUnlessClienteEdicion(session.supabase, session);
  if (deniedCli) return deniedCli;

  const { id: clienteId } = await params;

  const { data: cliente, error: clienteErr } = await session.supabase
    .from('cliente')
    .select('id')
    .eq('id', clienteId)
    .maybeSingle();

  if (clienteErr) {
    return NextResponse.json({ error: clienteErr.message }, { status: 500 });
  }
  if (!cliente) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  if (Object.keys(b).length === 0) {
    return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });
  }

  const patch = pickCondicionesKeys(b);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });
  }

  const { data: existing } = await session.supabase
    .from('cuenta_corriente')
    .select(
      'id, saldo, tipo_cuenta, cobro_modalidad, cobro_dias_plazo, cobro_periodicidad, cobro_dia_vencimiento_mes, cobro_monto_minimo',
    )
    .eq('cliente_id', clienteId)
    .maybeSingle();

  const base = existing
    ? {
        tipo_cuenta: existing.tipo_cuenta,
        cobro_modalidad: existing.cobro_modalidad,
        cobro_dias_plazo: existing.cobro_dias_plazo,
        cobro_periodicidad: existing.cobro_periodicidad,
        cobro_dia_vencimiento_mes: existing.cobro_dia_vencimiento_mes,
        cobro_monto_minimo: existing.cobro_monto_minimo,
      }
    : CUENTA_CORRIENTE_CONDICIONES_DEFAULTS;

  const applied = applyCondicionesCuentaPatch(base, patch);
  if (!applied.ok) {
    return NextResponse.json({ error: applied.error }, { status: 400 });
  }

  const row: Database['public']['Tables']['cuenta_corriente']['Update'] = {
    tipo_cuenta: applied.state.tipo_cuenta,
    cobro_modalidad: applied.state.cobro_modalidad,
    cobro_dias_plazo: applied.state.cobro_dias_plazo,
    cobro_periodicidad: applied.state.cobro_periodicidad,
    cobro_dia_vencimiento_mes: applied.state.cobro_dia_vencimiento_mes,
    cobro_monto_minimo: applied.state.cobro_monto_minimo,
  };

  if (existing) {
    const { data, error } = await session.supabase
      .from('cuenta_corriente')
      .update(row)
      .eq('id', existing.id)
      .select(
        'id, tipo_cuenta, cobro_modalidad, cobro_dias_plazo, cobro_periodicidad, cobro_dia_vencimiento_mes, cobro_monto_minimo, saldo, limite_credito',
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ cuenta: data });
  }

  const insert: Database['public']['Tables']['cuenta_corriente']['Insert'] = {
    tenant_id: session.tenantId,
    cliente_id: clienteId,
    saldo: 0,
    tipo_cuenta: applied.state.tipo_cuenta,
    cobro_modalidad: applied.state.cobro_modalidad,
    cobro_dias_plazo: applied.state.cobro_dias_plazo,
    cobro_periodicidad: applied.state.cobro_periodicidad,
    cobro_dia_vencimiento_mes: applied.state.cobro_dia_vencimiento_mes,
    cobro_monto_minimo: applied.state.cobro_monto_minimo,
  };

  const { data, error } = await session.supabase
    .from('cuenta_corriente')
    .insert(insert)
    .select(
      'id, tipo_cuenta, cobro_modalidad, cobro_dias_plazo, cobro_periodicidad, cobro_dia_vencimiento_mes, cobro_monto_minimo, saldo, limite_credito',
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ cuenta: data });
}
