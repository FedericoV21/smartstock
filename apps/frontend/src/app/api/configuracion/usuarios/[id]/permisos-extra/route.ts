import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { PERMISOS_ASIGNABLES_USUARIO } from '@/lib/api/permisos-asignables-usuario';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';

const ALLOW = new Set<string>(PERMISOS_ASIGNABLES_USUARIO);

async function assertCanManageUsers(
  session: Exclude<Awaited<ReturnType<typeof getTenantSession>>, { error: NextResponse }>,
) {
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const canManageUsers = await hasPermission(session.supabase, 'usuarios.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const allowManageUsers = session.isSuperAdmin || session.rol === 'admin' || canManageUsers;
  if (!allowManageUsers) {
    return NextResponse.json({ error: 'Solo el administrador puede editar usuarios' }, { status: 403 });
  }
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const guard = await assertCanManageUsers(session);
  if (guard) return guard;

  const { id: targetId } = await params;

  const { data: target, error: uErr } = await session.supabase
    .from('usuario')
    .select('id, rol')
    .eq('id', targetId)
    .eq('tenant_id', session.tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const { data: permRows, error: pErr } = await session.supabase
    .from('permiso')
    .select('id, clave')
    .in('clave', [...PERMISOS_ASIGNABLES_USUARIO]);

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  const allowIds = (permRows ?? []).map((r) => r.id);
  const idToClave = new Map((permRows ?? []).map((r) => [r.id, r.clave]));

  if (allowIds.length === 0) {
    return NextResponse.json({ permisos_clave: [] as string[], target_rol: target.rol });
  }

  const { data: upRows, error: upErr } = await session.supabase
    .from('usuario_permiso')
    .select('permiso_id')
    .eq('usuario_id', targetId)
    .in('permiso_id', allowIds);

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const claves = [...new Set((upRows ?? []).map((r) => idToClave.get(r.permiso_id)).filter(Boolean))] as string[];

  return NextResponse.json({
    permisos_clave: claves,
    target_rol: target.rol,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const guard = await assertCanManageUsers(session);
  if (guard) return guard;

  const { id: targetId } = await params;

  const { data: target, error: uErr } = await session.supabase
    .from('usuario')
    .select('id, rol')
    .eq('id', targetId)
    .eq('tenant_id', session.tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  if (target.rol === 'admin') {
    return NextResponse.json(
      { error: 'Los administradores tienen todos los permisos; no aplica asignación manual.' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const raw = b.permisos;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: 'permisos debe ser un array de claves' }, { status: 400 });
  }

  const clavesPedidas = [
    ...new Set(
      raw
        .map((x) => String(x).trim())
        .filter((c) => ALLOW.has(c)),
    ),
  ];

  const { data: permRows, error: pErr } = await session.supabase
    .from('permiso')
    .select('id, clave')
    .in('clave', [...PERMISOS_ASIGNABLES_USUARIO]);

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const claveToId = new Map((permRows ?? []).map((r) => [r.clave, r.id]));
  const allowIds = (permRows ?? []).map((r) => r.id);

  const permisoIdsInsert = clavesPedidas
    .map((c) => claveToId.get(c))
    .filter((id): id is string => typeof id === 'string');

  const { error: delErr } = await session.supabase
    .from('usuario_permiso')
    .delete()
    .eq('usuario_id', targetId)
    .in('permiso_id', allowIds);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  if (permisoIdsInsert.length > 0) {
    const { error: insErr } = await session.supabase.from('usuario_permiso').insert(
      permisoIdsInsert.map((permiso_id) => ({
        usuario_id: targetId,
        permiso_id,
      })),
    );

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, permisos_clave: clavesPedidas });
}
