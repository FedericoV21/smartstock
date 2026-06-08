import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const canManageUsers = await hasPermission(session.supabase, 'usuarios.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const allowManageUsers = session.isSuperAdmin || session.rol === 'admin' || canManageUsers;
  if (!allowManageUsers) {
    return NextResponse.json({ error: 'Sin permisos para gestionar usuarios.' }, { status: 403 });
  }

  const { id: userId } = await params;
  const admin = createServiceRoleClient();
  const adminDb = admin as any;

  const { data: targetUser, error: userErr } = await adminDb
    .from('usuario')
    .select('id')
    .eq('id', userId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (userErr || !targetUser) {
    return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });
  }

  const { data: rows, error } = await adminDb
    .from('usuario_sucursal')
    .select('sucursal_id')
    .eq('usuario_id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    sucursalIds: (rows ?? []).map((r: { sucursal_id: string }) => r.sucursal_id),
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const canManageUsers = await hasPermission(session.supabase, 'usuarios.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const allowManageUsers = session.isSuperAdmin || session.rol === 'admin' || canManageUsers;
  if (!allowManageUsers) {
    return NextResponse.json({ error: 'Sin permisos para gestionar usuarios.' }, { status: 403 });
  }

  const { id: userId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const sucursalIds = Array.isArray(b.sucursalIds)
    ? b.sucursalIds.map((v) => String(v)).filter(Boolean)
    : [];
  const defaultSucursalId =
    typeof b.defaultSucursalId === 'string' && b.defaultSucursalId.trim()
      ? b.defaultSucursalId.trim()
      : null;

  const admin = createServiceRoleClient();
  const adminDb = admin as any;

  const { data: targetUser, error: userErr } = await adminDb
    .from('usuario')
    .select('id')
    .eq('id', userId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (userErr || !targetUser) {
    return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });
  }

  if (sucursalIds.length === 0) {
    return NextResponse.json({ error: 'Debés asignar al menos una sucursal.' }, { status: 400 });
  }

  const { data: sucursales, error: sucErr } = await adminDb
    .from('sucursal')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .in('id', sucursalIds);

  if (sucErr) return NextResponse.json({ error: sucErr.message }, { status: 500 });

  const validIds = (sucursales ?? []).map((s: { id: string }) => s.id);
  if (validIds.length !== sucursalIds.length) {
    return NextResponse.json({ error: 'Una o más sucursales no pertenecen al negocio.' }, { status: 400 });
  }

  const resolvedDefaultId = defaultSucursalId && validIds.includes(defaultSucursalId)
    ? defaultSucursalId
    : validIds[0];

  const { error: deleteErr } = await adminDb.from('usuario_sucursal').delete().eq('usuario_id', userId);
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  const inserts: { usuario_id: string; sucursal_id: string }[] = [];
  for (const sucursalId of validIds as string[]) {
    inserts.push({ usuario_id: userId, sucursal_id: sucursalId });
  }
  const { error: insertErr } = await adminDb.from('usuario_sucursal').insert(inserts);
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  const { error: updateUserErr } = await adminDb
    .from('usuario')
    .update({ sucursal_default_id: resolvedDefaultId })
    .eq('id', userId)
    .eq('tenant_id', session.tenantId);

  if (updateUserErr) return NextResponse.json({ error: updateUserErr.message }, { status: 500 });

  return NextResponse.json({ success: true, sucursalIds: validIds, defaultSucursalId: resolvedDefaultId });
}

