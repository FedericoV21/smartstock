import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { rejectUnlessAccesoProveedoresApi, rejectUnlessProveedorEdicion } from '@/lib/api/permissions';
import {
  applyCondicionesCuentaPatch,
  type CondicionesCuentaState,
  CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS,
  pickCondicionesKeys,
} from '@/lib/cuenta-corriente/condiciones-patch';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const deniedProv = await rejectUnlessAccesoProveedoresApi(session.supabase, session);
  if (deniedProv) return deniedProv;

  const { id: proveedorId } = await params;

  const { data: prov, error: provErr } = await session.supabase
    .from('proveedor')
    .select('id')
    .eq('id', proveedorId)
    .maybeSingle();

  if (provErr) {
    return NextResponse.json({ error: provErr.message }, { status: 500 });
  }
  if (!prov) {
    return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 });
  }

  const { data: cuenta, error } = await session.supabase
    .from('cuenta_corriente')
    .select(
      'id, tipo_cuenta, cobro_modalidad, cobro_dias_plazo, cobro_periodicidad, cobro_dia_vencimiento_mes, cobro_monto_minimo, saldo, limite_credito',
    )
    .eq('proveedor_id', proveedorId)
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
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const deniedProv = await rejectUnlessProveedorEdicion(session.supabase, session);
  if (deniedProv) return deniedProv;

  const { id: proveedorId } = await params;

  const { data: prov, error: provErr } = await session.supabase
    .from('proveedor')
    .select('id')
    .eq('id', proveedorId)
    .maybeSingle();

  if (provErr) {
    return NextResponse.json({ error: provErr.message }, { status: 500 });
  }
  if (!prov) {
    return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 });
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

  const rawPatch = pickCondicionesKeys(b);
  const patch: Record<string, unknown> = { ...rawPatch };
  delete patch.tipo_cuenta;

  const { data: existing } = await session.supabase
    .from('cuenta_corriente')
    .select(
      'id, saldo, tipo_cuenta, cobro_modalidad, cobro_dias_plazo, cobro_periodicidad, cobro_dia_vencimiento_mes, cobro_monto_minimo',
    )
    .eq('proveedor_id', proveedorId)
    .maybeSingle();

  if (Object.keys(patch).length === 0 && existing) {
    return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });
  }

  const base: CondicionesCuentaState = existing
    ? {
        ...CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS,
        cobro_modalidad: existing.cobro_modalidad,
        cobro_dias_plazo: existing.cobro_dias_plazo,
        cobro_periodicidad: existing.cobro_periodicidad,
        cobro_dia_vencimiento_mes: existing.cobro_dia_vencimiento_mes,
        cobro_monto_minimo: existing.cobro_monto_minimo,
        tipo_cuenta: 'proveedor',
      }
    : CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS;

  const applied = applyCondicionesCuentaPatch(base, patch);
  if (!applied.ok) {
    return NextResponse.json({ error: applied.error }, { status: 400 });
  }
  if (applied.state.tipo_cuenta !== 'proveedor') {
    return NextResponse.json(
      { error: 'La cuenta de proveedor solo admite plazos y vencimientos, no un tipo de persona distinto' },
      { status: 400 },
    );
  }

  const row: Database['public']['Tables']['cuenta_corriente']['Update'] = {
    tipo_cuenta: 'proveedor',
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
    cliente_id: null,
    proveedor_id: proveedorId,
    saldo: 0,
    tipo_cuenta: 'proveedor',
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
