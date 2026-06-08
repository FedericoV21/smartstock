import { NextResponse, type NextRequest } from 'next/server';

import { rejectUnlessAccesoClientesApi } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import {
  contarCargosHoyPorCliente,
  ESTADOS_COMPROBANTE_MOVIMIENTOS_DIA,
} from '@/lib/cuenta-corriente/movimientos-dia';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { hoyEnAR } from '@/lib/utils/formatters';

/** Conteo de comprobantes CC emitidos hoy por cliente (badge en listado). */
export async function GET(request: NextRequest) {
  const guard = await moduloGuardAny(['facturador_simple', 'facturador_pos']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const deniedCli = await rejectUnlessAccesoClientesApi(session.supabase, session);
  if (deniedCli) return deniedCli;

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
    return NextResponse.json({
      fecha: hoyEnAR(),
      sucursal_id: sucursalScope.sucursalId,
      habilitado: false,
      por_cliente: {},
    });
  }

  const fechaHoy = hoyEnAR();

  const { data: rows, error } = await session.supabase
    .from('comprobante')
    .select('cliente_id')
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', sucursalScope.sucursalId)
    .eq('fecha', fechaHoy)
    .eq('metodo_pago', 'cuenta_corriente')
    .in('estado', [...ESTADOS_COMPROBANTE_MOVIMIENTOS_DIA])
    .not('cliente_id', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    fecha: fechaHoy,
    sucursal_id: sucursalScope.sucursalId,
    habilitado: true,
    por_cliente: contarCargosHoyPorCliente(
      (rows ?? []).filter((r): r is { cliente_id: string } => Boolean(r.cliente_id)),
    ),
  });
}
