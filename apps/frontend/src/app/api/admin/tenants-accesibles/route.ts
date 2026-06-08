import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';

export async function GET() {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  if (!session.isSuperAdmin) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const { data: accesos, error: accesoErr } = await session.supabase
    .from('super_admin_tenant_acceso')
    .select('tenant_id')
    .eq('usuario_id', session.userId);

  if (accesoErr) {
    return NextResponse.json({ error: accesoErr.message }, { status: 500 });
  }

  const ids = [...new Set((accesos ?? []).map((a) => a.tenant_id))];
  if (ids.length === 0) {
    return NextResponse.json({ tenants: [] as { id: string; nombre: string; cuit: string | null }[] });
  }

  const { data: tenants, error: tErr } = await session.supabase
    .from('tenant')
    .select('id, nombre, cuit')
    .in('id', ids)
    .order('nombre');

  if (tErr) {
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  return NextResponse.json({
    tenants: (tenants ?? []).map((t) => ({
      id: t.id,
      nombre: t.nombre,
      cuit: t.cuit ?? null,
    })),
  });
}
