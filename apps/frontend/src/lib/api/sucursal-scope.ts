import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import type { TenantSession } from '@/lib/api/tenant-session';

type SucursalScopeResult =
  | { ok: true; sucursalId: string | null }
  | { ok: false; response: NextResponse };

/** Primera sucursal activa del tenant (principal primero). Usado cuando el default del perfil es null o es de otro tenant (p. ej. super admin cambió de negocio). */
export async function principalOrFirstActiveSucursalId(db: any, tenantId: string): Promise<string | null> {
  const { data, error } = await db
    .from('sucursal')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('activa', true)
    .order('es_principal', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1);
  if (error || !data?.length) return null;
  return (data[0] as { id: string }).id;
}

/** Valor de `sucursal_id` en query: consolidar todo el tenant (solo admin / super admin). */
export const SUCURSAL_SCOPE_TODO_NEGOCIO = 'todas';

/**
 * Resuelve sucursal operativa (request o default del usuario) y valida alcance.
 * Si existe sucursal resuelta, exige que el usuario tenga permiso sobre esa sucursal.
 * Con `sucursal_id=todas` (o `*`), admin/super admin obtienen `sucursalId: null` (sin filtrar por sucursal).
 */
export async function resolveAndValidateSucursalScope(
  session: Exclude<TenantSession, { error: NextResponse }>,
  requestedSucursalId: string | null | undefined,
): Promise<SucursalScopeResult> {
  const db = session.supabase as any;
  const rawTrim = typeof requestedSucursalId === 'string' ? requestedSucursalId.trim() : '';
  const todoNegocio =
    rawTrim.toLowerCase() === SUCURSAL_SCOPE_TODO_NEGOCIO || rawTrim === '*';
  if (todoNegocio) {
    if (!session.isSuperAdmin && session.rol !== 'admin') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Solo los administradores pueden consolidar reportes de todo el negocio.' },
          { status: 403 },
        ),
      };
    }
    return { ok: true, sucursalId: null };
  }

  let sucursalId = rawTrim || null;
  let resolvedFromProfileDefault = false;

  if (!sucursalId) {
    const { data: me, error } = await db
      .from('usuario')
      .select('sucursal_default_id')
      .eq('id', session.userId)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        response: NextResponse.json({ error: error.message }, { status: 500 }),
      };
    }
    sucursalId = me?.sucursal_default_id ?? null;
    resolvedFromProfileDefault = Boolean(sucursalId);
  }

  if (!sucursalId) {
    if (session.isSuperAdmin || session.rol === 'admin') {
      const fb = await principalOrFirstActiveSucursalId(db, session.tenantId);
      if (fb) return { ok: true, sucursalId: fb };
    }
    return { ok: true, sucursalId: null };
  }

  if (session.isSuperAdmin || session.rol === 'admin') {
    const { data: sucursal, error: sucErr } = await db
      .from('sucursal')
      .select('id')
      .eq('id', sucursalId)
      .eq('tenant_id', session.tenantId)
      .eq('activa', true)
      .maybeSingle();

    if (sucErr) {
      return {
        ok: false,
        response: NextResponse.json({ error: sucErr.message }, { status: 500 }),
      };
    }
    if (!sucursal) {
      if (resolvedFromProfileDefault) {
        const fb = await principalOrFirstActiveSucursalId(db, session.tenantId);
        if (fb) return { ok: true, sucursalId: fb };
        return { ok: true, sucursalId: null };
      }
      return {
        ok: false,
        response: NextResponse.json({ error: 'Sucursal no encontrada o inactiva.' }, { status: 404 }),
      };
    }
    return { ok: true, sucursalId };
  }

  const { data: allowed, error: scopeErr } = await db.rpc('usuario_puede_operar_sucursal', {
    p_sucursal_id: sucursalId,
  });

  if (scopeErr) {
    return {
      ok: false,
      response: NextResponse.json({ error: scopeErr.message }, { status: 500 }),
    };
  }

  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'No tenés permisos para operar en esa sucursal.' },
        { status: 403 },
      ),
    };
  }

  return { ok: true, sucursalId };
}

/**
 * IDs de sucursales activas del tenant donde el usuario puede operar
 * (admin / permiso `sucursales.ver_todas`: todas; si no, `usuario_sucursal` + sucursal por defecto;
 * si sigue vacío y el tenant tiene una sola sucursal activa, se usa esa).
 */
export async function idsSucursalesOperables(
  session: Exclude<TenantSession, { error: NextResponse }>,
): Promise<{ ok: true; ids: string[] } | { ok: false; response: NextResponse }> {
  const db = session.supabase as any;

  const verTodas =
    session.isSuperAdmin ||
    session.rol === 'admin' ||
    (await hasPermission(session.supabase, 'sucursales.ver_todas', {
      rol: session.rol,
      isSuperAdmin: session.isSuperAdmin,
    }));

  if (verTodas) {
    const { data, error } = await db
      .from('sucursal')
      .select('id')
      .eq('tenant_id', session.tenantId)
      .eq('activa', true);

    if (error) {
      return {
        ok: false,
        response: NextResponse.json({ error: error.message }, { status: 500 }),
      };
    }
    return { ok: true, ids: (data ?? []).map((r: { id: string }) => r.id) };
  }

  const { data: rows, error } = await db
    .from('usuario_sucursal')
    .select('sucursal:sucursal_id(id, activa)')
    .eq('usuario_id', session.userId);

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }

  const ids: string[] = [];
  for (const r of rows ?? []) {
    const s = Array.isArray(r.sucursal) ? r.sucursal[0] : r.sucursal;
    if (s && typeof s === 'object' && 'id' in s && (s as { activa?: boolean }).activa === true) {
      ids.push((s as { id: string }).id);
    }
  }

  const { data: perfil, error: perfilErr } = await db
    .from('usuario')
    .select('sucursal_default_id')
    .eq('id', session.userId)
    .maybeSingle();
  if (perfilErr) {
    return {
      ok: false,
      response: NextResponse.json({ error: perfilErr.message }, { status: 500 }),
    };
  }
  const defRaw = perfil?.sucursal_default_id;
  const defId = typeof defRaw === 'string' ? defRaw.trim() : '';
  if (defId && !ids.includes(defId)) {
    const { data: sucDef } = await db
      .from('sucursal')
      .select('id')
      .eq('id', defId)
      .eq('tenant_id', session.tenantId)
      .eq('activa', true)
      .maybeSingle();
    if (sucDef?.id) ids.push(sucDef.id);
  }

  if (ids.length === 0) {
    const { count, error: cntErr } = await db
      .from('sucursal')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', session.tenantId)
      .eq('activa', true);
    if (cntErr) {
      return {
        ok: false,
        response: NextResponse.json({ error: cntErr.message }, { status: 500 }),
      };
    }
    if ((count ?? 0) === 1) {
      const fb = await principalOrFirstActiveSucursalId(db, session.tenantId);
      if (fb) ids.push(fb);
    }
  }

  return { ok: true, ids };
}

/**
 * Todas las sucursales activas del tenant (mismo alcance que un admin con «ver todas las sucursales»).
 * Para lecturas controladas (p. ej. catálogo al armar un pedido) donde los operadores deben ver el mismo universo de productos.
 */
export async function idsTodasSucursalesActivasTenant(
  session: Exclude<TenantSession, { error: NextResponse }>,
): Promise<{ ok: true; ids: string[] } | { ok: false; response: NextResponse }> {
  const db = session.supabase as any;
  const { data, error } = await db
    .from('sucursal')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .eq('activa', true);

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }
  return { ok: true, ids: (data ?? []).map((r: { id: string }) => r.id) };
}

