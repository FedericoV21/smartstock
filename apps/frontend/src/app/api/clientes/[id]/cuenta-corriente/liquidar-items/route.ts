import { NextResponse, type NextRequest } from 'next/server';

import { rejectUnlessAccesoClientesApi, rejectUnlessClienteEdicion } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import { liquidarItemsComprobanteCcDia, type LiquidarItemInput } from '@/lib/cuenta-corriente/liquidar-items-dia';
import { moduloGuardAny } from '@/lib/modulos/guard';

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuardAny(['facturador_simple', 'facturador_pos']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const deniedEdit = await rejectUnlessClienteEdicion(session.supabase, session);
  if (deniedEdit) return deniedEdit;

  const deniedCli = await rejectUnlessAccesoClientesApi(session.supabase, session);
  if (deniedCli) return deniedCli;

  const { id: clienteId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const raw = body as {
    sucursal_id?: string;
    comprobante_id?: string;
    items?: { id?: string; precio_unitario?: number }[];
  };

  const sucursalScope = await resolveAndValidateSucursalScope(session, raw.sucursal_id);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'Indicá la sucursal operativa.' }, { status: 400 });
  }

  const businessPrefs = await loadEffectiveBusinessPrefs(
    session.supabase,
    session.tenantId,
    sucursalScope.sucursalId,
  );
  if (!businessPrefs.cuentaCorrienteDistribuidora.permitirLiquidacionItemsDia) {
    return NextResponse.json(
      { error: 'La liquidación de precios del día no está habilitada en esta sucursal.' },
      { status: 403 },
    );
  }
  if (!businessPrefs.cuentaCorrienteDistribuidora.panelMovimientosDia) {
    return NextResponse.json(
      { error: 'Activá también el panel de movimientos del día en esta sucursal.' },
      { status: 403 },
    );
  }

  const comprobanteId = typeof raw.comprobante_id === 'string' ? raw.comprobante_id.trim() : '';
  if (!comprobanteId) {
    return NextResponse.json({ error: 'Falta comprobante_id.' }, { status: 400 });
  }

  const items: LiquidarItemInput[] = [];
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    return NextResponse.json({ error: 'Indicá al menos un ítem con precio.' }, { status: 400 });
  }
  for (const row of raw.items) {
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const pu = Number(row.precio_unitario);
    if (!id || !Number.isFinite(pu)) {
      return NextResponse.json({ error: 'Ítem o precio inválido.' }, { status: 400 });
    }
    items.push({ id, precio_unitario: pu });
  }

  const { data: tenant } = await session.supabase
    .from('tenant')
    .select('iva_porcentaje_default')
    .eq('id', session.tenantId)
    .maybeSingle();

  const ivaFallback =
    tenant?.iva_porcentaje_default != null ? Number(tenant.iva_porcentaje_default) : 21;

  const result = await liquidarItemsComprobanteCcDia(session.supabase, {
    tenantId: session.tenantId,
    clienteId,
    sucursalId: sucursalScope.sucursalId,
    comprobanteId,
    items,
    ivaFallback,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    total: result.total,
    delta: result.delta,
  });
}
