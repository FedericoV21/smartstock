import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { rejectUnlessAccesoProveedoresApi } from '@/lib/api/permissions';
import { listarFacturasImportadasProveedor } from '@/lib/proveedores/facturas-importadas-query';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const deniedProv = await rejectUnlessAccesoProveedoresApi(session.supabase, session);
  if (deniedProv) return deniedProv;

  const { id: proveedorId } = await params;
  const url = new URL(request.url);
  const pagina = Math.max(1, Number.parseInt(url.searchParams.get('pagina') ?? '1', 10) || 1);

  const { data: proveedor, error: provErr } = await session.supabase
    .from('proveedor')
    .select('id')
    .eq('id', proveedorId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (provErr) {
    return NextResponse.json({ error: provErr.message }, { status: 500 });
  }
  if (!proveedor) {
    return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 });
  }

  try {
    const resultado = await listarFacturasImportadasProveedor(
      session.supabase,
      session.tenantId,
      proveedorId,
      pagina,
    );
    return NextResponse.json(resultado);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al listar facturas importadas';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
