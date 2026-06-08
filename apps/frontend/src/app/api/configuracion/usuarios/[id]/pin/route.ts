import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { hashPin, isValidPin } from '@/lib/auth/local-credentials';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function POST(
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
  const pin = String(b.pin ?? '');
  const pinTemporal = typeof b.pinTemporal === 'boolean' ? b.pinTemporal : true;

  if (!isValidPin(pin)) {
    return NextResponse.json({ error: 'El PIN debe tener entre 4 y 8 dígitos.' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const adminDb = admin as any;

  const { data: targetUser, error: userErr } = await adminDb
    .from('usuario')
    .select('id, tenant_id')
    .eq('id', userId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (userErr || !targetUser) {
    return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });
  }

  const pinHash = await hashPin(pin);

  const { data: existingCred, error: credErr } = await adminDb
    .from('usuario_credencial_local')
    .select('username_local')
    .eq('usuario_id', userId)
    .maybeSingle();
  if (credErr) {
    return NextResponse.json({ error: credErr.message }, { status: 500 });
  }
  if (!existingCred) {
    return NextResponse.json(
      { error: 'Este usuario no tiene credencial local para PIN.' },
      { status: 400 },
    );
  }

  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    password: pin,
  });
  if (authErr) {
    return NextResponse.json({ error: `No se pudo actualizar Auth: ${authErr.message}` }, { status: 500 });
  }

  const { error: upsertErr } = await adminDb.from('usuario_credencial_local').upsert({
    usuario_id: userId,
    tenant_id: session.tenantId,
    username_local: existingCred.username_local,
    pin_hash: pinHash,
    pin_temporal: pinTemporal,
    activo: true,
    intentos_fallidos: 0,
    bloqueado_hasta: null,
  });

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

