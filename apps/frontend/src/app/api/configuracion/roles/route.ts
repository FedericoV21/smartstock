import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';

export async function GET() {
  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const db = session.supabase as any;

  const canManageRoles = await hasPermission(session.supabase, 'roles.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const allowManageRoles = session.isSuperAdmin || session.rol === 'admin' || canManageRoles;
  if (!allowManageRoles) {
    return NextResponse.json({ error: 'Sin permisos para ver roles.' }, { status: 403 });
  }

  const [{ data: roles, error: roleErr }, { data: permisos, error: permErr }] = await Promise.all([
    db
      .from('rol')
      .select('id, slug, nombre, descripcion, es_base, activo')
      .eq('tenant_id', session.tenantId)
      .order('es_base', { ascending: false })
      .order('nombre', { ascending: true }),
    db.from('permiso').select('id, clave, modulo, descripcion').order('clave', { ascending: true }),
  ]);

  if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 500 });
  if (permErr) return NextResponse.json({ error: permErr.message }, { status: 500 });

  const rolesVisibles = session.isSuperAdmin
    ? (roles ?? [])
    : (roles ?? []).filter((r: { slug: string }) => r.slug !== 'superadmin');

  const roleIds = rolesVisibles.map((r: { id: string }) => r.id);
  const { data: rolePermisos, error: rpErr } = roleIds.length
    ? await db.from('rol_permiso').select('rol_id, permiso_id').in('rol_id', roleIds)
    : { data: [], error: null };
  if (rpErr) return NextResponse.json({ error: rpErr.message }, { status: 500 });

  const permisosById = new Map<string, { id: string; clave: string }>(
    (permisos ?? []).map((p: { id: string; clave: string }) => [p.id, p]),
  );
  const map = new Map<string, string[]>();
  for (const rp of (rolePermisos ?? []) as { rol_id: string; permiso_id: string }[]) {
    const perm = permisosById.get(rp.permiso_id);
    if (!perm) continue;
    const arr = map.get(rp.rol_id) ?? [];
    arr.push(perm.clave);
    map.set(rp.rol_id, arr);
  }

  return NextResponse.json({
    permisos: permisos ?? [],
    roles: rolesVisibles.map((r: { id: string }) => ({
      ...r,
      permisos: map.get(r.id) ?? [],
    })),
  });
}

export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const db = session.supabase as any;
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const slug = String(b.slug ?? '').trim().toLowerCase();
  const nombre = String(b.nombre ?? '').trim();
  const descripcion = b.descripcion == null ? null : String(b.descripcion).trim();
  const permisos = Array.isArray(b.permisos) ? b.permisos.map((p) => String(p).trim()).filter(Boolean) : [];

  if (!slug || !nombre) {
    return NextResponse.json({ error: 'slug y nombre son obligatorios.' }, { status: 400 });
  }

  const { data: created, error: createErr } = await db
    .from('rol')
    .insert({
      tenant_id: session.tenantId,
      slug,
      nombre,
      descripcion,
      es_base: false,
      activo: true,
    })
    .select('id, slug, nombre, descripcion, es_base, activo')
    .single();
  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 400 });

  if (permisos.length > 0) {
    const { data: permsRows, error: permsErr } = await db
      .from('permiso')
      .select('id, clave')
      .in('clave', permisos);
    if (permsErr) return NextResponse.json({ error: permsErr.message }, { status: 500 });
    const inserts = (permsRows ?? []).map((p: { id: string }) => ({ rol_id: created.id, permiso_id: p.id }));
    if (inserts.length > 0) {
      const { error: insErr } = await db.from('rol_permiso').insert(inserts);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json(created, { status: 201 });
}

