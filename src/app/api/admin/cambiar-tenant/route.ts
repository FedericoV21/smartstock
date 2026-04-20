import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';

function parseBody(raw: unknown): { tenantId: string | null } | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.tenant_id === null) return { tenantId: null };
  if (typeof o.tenant_id === 'string') {
    const s = o.tenant_id.trim();
    if (s === '') return { tenantId: null };
    return { tenantId: s };
  }
  return null;
}

export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  if (!session.isSuperAdmin) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if (!parsed) {
    return NextResponse.json({ error: 'tenant_id inválido' }, { status: 400 });
  }

  const { error } = await session.supabase.rpc('super_admin_set_tenant_contexto', {
    p_tenant_id: parsed.tenantId,
  });

  if (error) {
    const msg = error.message || 'No se pudo cambiar de cuenta';
    const low = msg.toLowerCase();
    if (low.includes('sin acceso') || low.includes('sin permisos')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
