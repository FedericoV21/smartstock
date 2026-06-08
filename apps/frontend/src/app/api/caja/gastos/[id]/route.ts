import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { sumarGastosSesion } from '@/lib/caja/caja-gastos-sesion';
import { moduloGuard } from '@/lib/modulos/guard';

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await ctx.params;
  const gastoId = String(id ?? '').trim();
  if (!gastoId) {
    return NextResponse.json({ error: 'ID de gasto inválido.' }, { status: 400 });
  }

  const db = session.supabase as any;
  const { data: gasto, error: selErr } = await db
    .from('caja_gasto')
    .select('id, tenant_id, caja_apertura_id, anulado_at, cierre_z_id')
    .eq('id', gastoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  if (!gasto) {
    return NextResponse.json({ error: 'Gasto no encontrado.' }, { status: 404 });
  }
  if (gasto.anulado_at) {
    return NextResponse.json({ error: 'El gasto ya fue anulado.' }, { status: 409 });
  }
  if (gasto.cierre_z_id) {
    return NextResponse.json({ error: 'No se puede anular un gasto ya incluido en un cierre.' }, { status: 409 });
  }

  const { error: updErr } = await db
    .from('caja_gasto')
    .update({
      anulado_at: new Date().toISOString(),
      anulado_por: session.userId,
    })
    .eq('id', gastoId)
    .eq('tenant_id', session.tenantId)
    .is('anulado_at', null)
    .is('cierre_z_id', null);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const total = await sumarGastosSesion(db, String(gasto.caja_apertura_id));
  return NextResponse.json({ ok: true, total });
}
