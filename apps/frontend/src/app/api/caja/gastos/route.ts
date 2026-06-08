import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { listarGastosSesionVigentes, sumarGastosSesion } from '@/lib/caja/caja-gastos-sesion';
import { redondear2 } from '@/lib/caja/cierre-z-calculo';
import { resolverContextoCajaGastos } from '@/lib/caja/resolver-caja-gastos-api';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const sp = new URL(request.url).searchParams;
  const cajaId = sp.get('caja_id');
  const requestedSucursalId = sp.get('sucursal_id');
  const sucursalScope = await resolveAndValidateSucursalScope(session, requestedSucursalId);
  if (!sucursalScope.ok) return sucursalScope.response;

  const ctxRes = await resolverContextoCajaGastos(
    session.supabase as any,
    session.tenantId,
    session.userId,
    cajaId,
  );
  if (!ctxRes.ok) {
    return NextResponse.json({ error: ctxRes.error }, { status: ctxRes.status });
  }
  if (sucursalScope.sucursalId && sucursalScope.sucursalId !== ctxRes.ctx.sucursalId) {
    return NextResponse.json({ error: 'La caja no pertenece a la sucursal operativa.' }, { status: 403 });
  }

  try {
    const items = await listarGastosSesionVigentes(session.supabase as any, ctxRes.ctx.aperturaId);
    const total = await sumarGastosSesion(session.supabase as any, ctxRes.ctx.aperturaId);
    return NextResponse.json({
      items,
      total,
      caja_apertura_id: ctxRes.ctx.aperturaId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al listar gastos';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: { caja_id?: string | null; concepto?: string | null; monto?: number | string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const concepto = String(body.concepto ?? '').trim();
  if (!concepto) {
    return NextResponse.json({ error: 'Indicá de qué es el gasto (concepto).' }, { status: 400 });
  }
  const montoRaw = body.monto;
  const montoNum = montoRaw === null || montoRaw === undefined || montoRaw === '' ? NaN : Number(montoRaw);
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    return NextResponse.json({ error: 'El monto debe ser un número mayor a 0.' }, { status: 400 });
  }

  const ctxRes = await resolverContextoCajaGastos(
    session.supabase as any,
    session.tenantId,
    session.userId,
    body.caja_id,
  );
  if (!ctxRes.ok) {
    return NextResponse.json({ error: ctxRes.error }, { status: ctxRes.status });
  }

  const db = session.supabase as any;
  const { count, error: countErr } = await db
    .from('caja_gasto')
    .select('id', { count: 'exact', head: true })
    .eq('caja_apertura_id', ctxRes.ctx.aperturaId)
    .is('anulado_at', null)
    .is('cierre_z_id', null);
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if ((count ?? 0) >= 25) {
    return NextResponse.json({ error: 'Máximo 25 gastos por sesión de caja.' }, { status: 400 });
  }

  const { data: row, error: insErr } = await db
    .from('caja_gasto')
    .insert({
      tenant_id: session.tenantId,
      sucursal_id: ctxRes.ctx.sucursalId,
      caja_id: ctxRes.ctx.cajaIdText,
      caja_apertura_id: ctxRes.ctx.aperturaId,
      concepto: concepto.slice(0, 200),
      monto: redondear2(montoNum),
      usuario_id: session.userId,
    })
    .select('id, concepto, monto, created_at, usuario_id')
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const total = await sumarGastosSesion(db, ctxRes.ctx.aperturaId);
  return NextResponse.json(
    {
      item: {
        id: row.id,
        concepto: row.concepto,
        monto: Number(row.monto),
        created_at: row.created_at,
        usuario_id: row.usuario_id,
      },
      total,
    },
    { status: 201 },
  );
}
