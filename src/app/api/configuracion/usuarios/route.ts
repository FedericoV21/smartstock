import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { USUARIOS_MAX_POR_TENANT } from '@/lib/limits';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RolInvite = Extract<Database['public']['Enums']['rol_usuario'], 'operador' | 'visor'>;

export async function GET() {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { data: me } = await session.supabase
    .from('usuario')
    .select('rol')
    .eq('id', session.userId)
    .maybeSingle();

  if (!me || me.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo el administrador puede ver usuarios' }, { status: 403 });
  }

  const { data, error } = await session.supabase
    .from('usuario')
    .select('id, email, nombre, apellido, rol, activo, created_at')
    .eq('tenant_id', session.tenantId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ usuarios: data ?? [] });
}

export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { data: me } = await session.supabase
    .from('usuario')
    .select('rol')
    .eq('id', session.userId)
    .maybeSingle();

  if (!me || me.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo el administrador puede invitar usuarios' }, { status: 403 });
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

  const email = String(b.email ?? '')
    .trim()
    .toLowerCase();
  const nombre = String(b.nombre ?? '').trim();
  const apellido = String(b.apellido ?? '').trim();
  const rol = b.rol === 'visor' ? 'visor' : b.rol === 'operador' ? 'operador' : null;

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Correo electrónico inválido' }, { status: 400 });
  }
  if (!nombre || !apellido) {
    return NextResponse.json({ error: 'Nombre y apellido son obligatorios' }, { status: 400 });
  }
  if (!rol) {
    return NextResponse.json({ error: 'Rol inválido (operador o visor)' }, { status: 400 });
  }

  const { data: existe } = await session.supabase
    .from('usuario')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .ilike('email', email)
    .maybeSingle();

  if (existe) {
    return NextResponse.json(
      { error: 'Ya existe un usuario con ese correo en tu negocio' },
      { status: 409 },
    );
  }

  const { count: nActivos, error: countErr } = await session.supabase
    .from('usuario')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', session.tenantId)
    .eq('activo', true);

  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((nActivos ?? 0) >= USUARIOS_MAX_POR_TENANT) {
    return NextResponse.json(
      { error: `Tu negocio puede tener como máximo ${USUARIOS_MAX_POR_TENANT} usuarios` },
      { status: 403 },
    );
  }

  const base =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const admin = createServiceRoleClient();

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${base.replace(/\/$/, '')}/api/auth/callback?next=/`,
  });

  if (inviteErr || !invited.user?.id) {
    const msg = inviteErr?.message ?? 'No se pudo enviar la invitación';
    if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
      return NextResponse.json(
        { error: 'Ese correo ya está registrado en el sistema' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const userId = invited.user.id;

  const { error: insErr } = await admin.from('usuario').insert({
    id: userId,
    tenant_id: session.tenantId,
    email,
    nombre,
    apellido,
    rol: rol as RolInvite,
    activo: true,
  });

  if (insErr) {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: userId }, { status: 201 });
}
