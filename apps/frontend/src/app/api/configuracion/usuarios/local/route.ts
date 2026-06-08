import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import {
  buildLocalAuthEmail,
  hashPin,
  isValidPin,
  normalizeLocalUsername,
} from '@/lib/auth/local-credentials';
import { getUsuariosMaxPorPlan } from '@/lib/limits';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type RolInvite = Extract<Database['public']['Enums']['rol_usuario'], 'operador' | 'visor' | 'admin'>;

export async function POST(request: Request) {
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
    return NextResponse.json({ error: 'Sin permisos para crear usuarios.' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const nombre = String(b.nombre ?? '').trim();
  const apellido = String(b.apellido ?? '').trim();
  const username = normalizeLocalUsername(String(b.username ?? ''));
  const pin = String(b.pin ?? '');
  const rol = b.rol === 'visor' ? 'visor' : b.rol === 'admin' ? 'admin' : 'operador';
  const rolId = typeof b.rolId === 'string' && b.rolId.trim() ? b.rolId.trim() : null;
  const sucursalIds = Array.isArray(b.sucursalIds)
    ? b.sucursalIds.map((v) => String(v)).filter(Boolean)
    : [];

  if (!nombre || !apellido || !username) {
    return NextResponse.json({ error: 'Nombre, apellido y username son obligatorios.' }, { status: 400 });
  }
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: 'El PIN debe tener entre 4 y 8 dígitos.' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const adminDb = admin as any;

  const { data: tenant, error: tenantErr } = await adminDb
    .from('tenant')
    .select('plan')
    .eq('id', session.tenantId)
    .maybeSingle();
  if (tenantErr) return NextResponse.json({ error: tenantErr.message }, { status: 500 });

  const limiteUsuarios = getUsuariosMaxPorPlan(tenant?.plan);
  const { count: nActivos, error: countErr } = await adminDb
    .from('usuario')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', session.tenantId)
    .is('deleted_at', null)
    .eq('activo', true);
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if (limiteUsuarios != null && (nActivos ?? 0) >= limiteUsuarios) {
    return NextResponse.json(
      { error: `Tu negocio puede tener como máximo ${limiteUsuarios} usuarios activos` },
      { status: 403 },
    );
  }

  const { data: existing } = await adminDb
    .from('usuario_credencial_local')
    .select('usuario_id')
    .eq('tenant_id', session.tenantId)
    .ilike('username_local', username)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: 'Ya existe un usuario local con ese nombre de usuario.' },
      { status: 409 },
    );
  }

  const localEmail = buildLocalAuthEmail(session.tenantId, username);
  const pinHash = await hashPin(pin);

  let authUserId: string | null = null;
  try {
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email: localEmail,
      password: pin,
      email_confirm: true,
      user_metadata: { local_auth: true, username_local: username },
    });

    if (authErr || !authData.user?.id) {
      return NextResponse.json({ error: authErr?.message ?? 'No se pudo crear usuario auth.' }, { status: 400 });
    }
    authUserId = authData.user.id;

    const { data: baseRole, error: baseRoleErr } = await adminDb
      .from('rol')
      .select('id, slug')
      .eq('tenant_id', session.tenantId)
      .eq('slug', rol)
      .maybeSingle();
    if (baseRoleErr) throw new Error(baseRoleErr.message);

    let targetRoleId = baseRole?.id ?? null;
    let rolLegacyForUser = rol as RolInvite;

    if (rolId) {
      const { data: customRole, error: customRoleErr } = await adminDb
        .from('rol')
        .select('id, slug, es_base, activo')
        .eq('id', rolId)
        .eq('tenant_id', session.tenantId)
        .maybeSingle();
      if (customRoleErr) throw new Error(customRoleErr.message);
      if (!customRole || !customRole.activo) {
        return NextResponse.json({ error: 'Rol personalizado inválido o inactivo.' }, { status: 400 });
      }
      targetRoleId = customRole.id;
      if (customRole.es_base && (customRole.slug === 'admin' || customRole.slug === 'operador' || customRole.slug === 'visor')) {
        rolLegacyForUser = customRole.slug as RolInvite;
      } else {
        rolLegacyForUser = 'operador';
      }
    }

    const { error: userErr } = await adminDb.from('usuario').insert({
      id: authUserId,
      tenant_id: session.tenantId,
      email: localEmail,
      nombre,
      apellido,
      rol: rolLegacyForUser,
      activo: true,
    });
    if (userErr) throw new Error(userErr.message);

    if (targetRoleId) {
      const { error: userRoleErr } = await adminDb.from('usuario_rol').insert({
        usuario_id: authUserId,
        rol_id: targetRoleId,
      });
      if (userRoleErr) throw new Error(userRoleErr.message);
    }

    const { error: credErr } = await adminDb.from('usuario_credencial_local').insert({
      usuario_id: authUserId,
      tenant_id: session.tenantId,
      username_local: username,
      pin_hash: pinHash,
      pin_temporal: true,
      activo: true,
    });
    if (credErr) throw new Error(credErr.message);

    if (sucursalIds.length > 0) {
      const { data: sucursales, error: sucErr } = await adminDb
        .from('sucursal')
        .select('id')
        .eq('tenant_id', session.tenantId)
        .in('id', sucursalIds);
      if (sucErr) throw new Error(sucErr.message);

      const validIds = (sucursales ?? []).map((s: { id: string }) => s.id);
      if (validIds.length > 0) {
        const payload = validIds.map((sucursalId: string) => ({ usuario_id: authUserId!, sucursal_id: sucursalId }));
        const { error: assignErr } = await adminDb.from('usuario_sucursal').insert(payload);
        if (assignErr) throw new Error(assignErr.message);

        await adminDb
          .from('usuario')
          .update({ sucursal_default_id: validIds[0] })
          .eq('id', authUserId)
          .eq('tenant_id', session.tenantId);
      }
    }

    return NextResponse.json({ success: true, id: authUserId }, { status: 201 });
  } catch (error) {
    if (authUserId) {
      await admin.auth.admin.deleteUser(authUserId);
    }
    const message = error instanceof Error ? error.message : 'No se pudo crear el usuario local.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

