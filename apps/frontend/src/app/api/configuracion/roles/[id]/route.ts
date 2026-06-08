import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import type { Database } from '@/types/database';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const canManageRoles = await hasPermission(session.supabase, 'roles.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const allowManageRoles = session.isSuperAdmin || session.rol === 'admin' || canManageRoles;
  if (!allowManageRoles) {
    return NextResponse.json({ error: 'Sin permisos para gestionar roles.' }, { status: 403 });
  }

  const { id } = await params;
  const db = session.supabase as any;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const updates: Record<string, unknown> = {};

  if (typeof b.nombre === 'string') updates.nombre = b.nombre.trim();
  if (typeof b.descripcion === 'string' || b.descripcion === null) updates.descripcion = b.descripcion;
  if (typeof b.activo === 'boolean') updates.activo = b.activo;

  const { data: rol, error: findErr } = await db
    .from('rol')
    .select('id, es_base')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (findErr || !rol) return NextResponse.json({ error: 'Rol no encontrado.' }, { status: 404 });

  if (rol.es_base && ('activo' in updates)) {
    delete updates.activo;
  }

  if (Object.keys(updates).length > 0) {
    const { error: upErr } = await db
      .from('rol')
      .update(updates as Database['public']['Tables']['rol']['Update'])
      .eq('id', id)
      .eq('tenant_id', session.tenantId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
  }

  if (Array.isArray(b.permisos)) {
    const claves = b.permisos.map((p) => String(p).trim()).filter(Boolean);
    const { data: permsRows, error: permsErr } = await db
      .from('permiso')
      .select('id, clave')
      .in('clave', claves);
    if (permsErr) return NextResponse.json({ error: permsErr.message }, { status: 500 });

    const { error: delErr } = await db.from('rol_permiso').delete().eq('rol_id', id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    const inserts = (permsRows ?? []).map((p: { id: string }) => ({ rol_id: id, permiso_id: p.id }));
    if (inserts.length > 0) {
      const { error: insErr } = await db.from('rol_permiso').insert(inserts);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

