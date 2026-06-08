import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { rejectUnlessAccesoProveedoresPosApi } from '@/lib/api/permissions';

export async function GET() {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const deniedProv = await rejectUnlessAccesoProveedoresPosApi(session.supabase, session);
  if (deniedProv) return deniedProv;

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json(
      { error: 'No hay sucursal operativa seleccionada.' },
      { status: 400 },
    );
  }

  const { supabase, tenantId } = session;

  const { data: modCfg } = await supabase
    .from('modulo_config')
    .select('facturador_pos')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!modCfg?.facturador_pos) {
    return NextResponse.json(
      { error: "El módulo 'facturador_pos' no está habilitado para tu plan." },
      { status: 403 },
    );
  }

  const { data, error } = await session.supabase
    .from('proveedor')
    .select('id, nombre')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .order('nombre');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ proveedores: data ?? [] });
}
