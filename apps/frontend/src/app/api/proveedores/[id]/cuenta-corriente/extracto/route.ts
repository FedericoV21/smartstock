import { NextResponse, type NextRequest } from 'next/server';

import { rejectUnlessAccesoProveedoresApi } from '@/lib/api/permissions';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import {
  extractoProveedorACsv,
  fetchExtractoProveedor,
  periodoDesdeSearchParams,
} from '@/lib/proveedores/fetch-extracto-proveedor-data';

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const deniedProv = await rejectUnlessAccesoProveedoresApi(session.supabase, session);
  if (deniedProv) return deniedProv;

  const { id: proveedorId } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const { desde, hasta, label } = periodoDesdeSearchParams(searchParams);
  const exportFmt = (searchParams.get('export') || '').toLowerCase();

  const result = await fetchExtractoProveedor(session.supabase, {
    tenantId: session.tenantId,
    proveedorId,
    desde,
    hasta,
    periodoLabel: label,
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (exportFmt === 'csv') {
    const csv = extractoProveedorACsv(result);
    const safeName = result.proveedor_nombre.replace(/[^\w\s-]/g, '').slice(0, 40);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="extracto-cc-proveedor-${safeName}-${desde}-${hasta}.csv"`,
      },
    });
  }

  return NextResponse.json(result);
}
