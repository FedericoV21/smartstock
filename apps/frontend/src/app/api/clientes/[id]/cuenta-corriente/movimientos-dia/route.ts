import { NextResponse, type NextRequest } from 'next/server';

import { rejectUnlessAccesoClientesApi } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import {
  buildMovimientosDiaPayload,
  ESTADOS_COMPROBANTE_MOVIMIENTOS_DIA,
  type MovimientoDiaComprobanteRow,
} from '@/lib/cuenta-corriente/movimientos-dia';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { hoyEnAR } from '@/lib/utils/formatters';

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuardAny(['facturador_simple', 'facturador_pos']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const deniedCli = await rejectUnlessAccesoClientesApi(session.supabase, session);
  if (deniedCli) return deniedCli;

  const { id: clienteId } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const sucursalScope = await resolveAndValidateSucursalScope(
    session,
    searchParams.get('sucursal_id'),
  );
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'Indicá la sucursal operativa.' }, { status: 400 });
  }

  const businessPrefs = await loadEffectiveBusinessPrefs(
    session.supabase,
    session.tenantId,
    sucursalScope.sucursalId,
  );
  if (!businessPrefs.cuentaCorrienteDistribuidora.panelMovimientosDia) {
    return NextResponse.json(
      { error: 'El panel de movimientos del día no está habilitado en esta sucursal.' },
      { status: 403 },
    );
  }

  const { data: cliente, error: cliErr } = await session.supabase
    .from('cliente')
    .select('id')
    .eq('id', clienteId)
    .maybeSingle();

  if (cliErr || !cliente) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  }

  const { data: sucursal, error: sucErr } = await session.supabase
    .from('sucursal')
    .select('id, nombre')
    .eq('id', sucursalScope.sucursalId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (sucErr) {
    return NextResponse.json({ error: sucErr.message }, { status: 500 });
  }

  const { data: cuenta, error: ccErr } = await session.supabase
    .from('cuenta_corriente')
    .select('saldo')
    .eq('cliente_id', clienteId)
    .maybeSingle();

  if (ccErr) {
    return NextResponse.json({ error: ccErr.message }, { status: 500 });
  }

  const fechaHoy = hoyEnAR();

  const { data: comprobantes, error: compErr } = await session.supabase
    .from('comprobante')
    .select(
      `
      id,
      tipo,
      numero,
      numero_caja,
      fecha,
      created_at,
      total,
      cae,
      comprobante_item (
        id,
        cantidad,
        precio_unitario,
        subtotal,
        producto_variante_etiqueta,
        producto ( nombre, codigo, unidad, es_pesable )
      )
    `,
    )
    .eq('cliente_id', clienteId)
    .eq('sucursal_id', sucursalScope.sucursalId)
    .eq('fecha', fechaHoy)
    .eq('metodo_pago', 'cuenta_corriente')
    .in('estado', [...ESTADOS_COMPROBANTE_MOVIMIENTOS_DIA])
    .order('created_at', { ascending: true });

  if (compErr) {
    return NextResponse.json({ error: compErr.message }, { status: 500 });
  }

  const { data: tenant } = await session.supabase
    .from('tenant')
    .select('punto_de_venta')
    .maybeSingle();

  const pv = tenant?.punto_de_venta ?? 1;

  const payload = buildMovimientosDiaPayload({
    sucursalId: sucursalScope.sucursalId,
    sucursalNombre: sucursal?.nombre ?? null,
    saldoCuenta: cuenta?.saldo != null ? Number(cuenta.saldo) : null,
    comprobantes: (comprobantes ?? []) as MovimientoDiaComprobanteRow[],
    puntoDeVenta: pv,
    fecha: fechaHoy,
    liquidacionHabilitada: businessPrefs.cuentaCorrienteDistribuidora.permitirLiquidacionItemsDia,
  });

  return NextResponse.json(payload);
}
