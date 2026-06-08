import { NextResponse, type NextRequest } from 'next/server';

import { rejectUnlessAccesoClientesApi } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import {
  extractoACsv,
  fetchExtractoCuentaCorriente,
  periodoDesdeSearchParams,
} from '@/lib/cuenta-corriente/fetch-extracto-data';
import { resolveExtractoEdicionOpts } from '@/lib/cuenta-corriente/fetch-extracto-edicion-opts';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuard('facturador_simple');
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

  const { desde, hasta, label } = periodoDesdeSearchParams(searchParams);
  const exportFmt = (searchParams.get('export') || '').toLowerCase();
  const edicion = await resolveExtractoEdicionOpts(session.supabase, {
    tenantId: session.tenantId,
    rol: session.rol,
    sucursalId: sucursalScope.sucursalId,
  });

  const result = await fetchExtractoCuentaCorriente(session.supabase, {
    tenantId: session.tenantId,
    clienteId,
    desde,
    hasta,
    periodoLabel: label,
    sucursalId: sucursalScope.sucursalId,
    puedeEditar: edicion.puedeEditar,
    liquidacionHabilitada: edicion.liquidacionHabilitada,
    liquidacionPorSucursal: edicion.liquidacionPorSucursal,
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (exportFmt === 'csv') {
    const csv = extractoACsv(result);
    const safeName = result.cliente_nombre.replace(/[^\w\s-]/g, '').slice(0, 40);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="extracto-cc-${safeName}-${desde}-${hasta}.csv"`,
      },
    });
  }

  return NextResponse.json(result);
}
