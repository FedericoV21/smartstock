import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession } from '@/lib/api/tenant-session';
import { cajaServerDebug } from '@/lib/caja/debug-caja-logs';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET() {
  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const db = session.supabase as any;

  const hasViewAllPermission = await hasPermission(session.supabase, 'sucursales.ver_todas', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const canViewAll = session.isSuperAdmin || session.rol === 'admin' || hasViewAllPermission;

  const { data: me, error: meErr } = await db
    .from('usuario')
    .select('sucursal_default_id')
    .eq('id', session.userId)
    .maybeSingle();

  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });

  if (canViewAll) {
    const { data: sucursales, error } = await db
      .from('sucursal')
      .select('id, codigo, nombre, activa, es_principal')
      .eq('tenant_id', session.tenantId)
      .eq('activa', true)
      .order('created_at', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const list = sucursales ?? [];
    cajaServerDebug('sucursal-activa:GET', {
      canViewAll: true,
      userId: session.userId,
      rol: session.rol,
      sucursal_default_id: me?.sucursal_default_id ?? null,
      sucursales_count: list.length,
      sucursal_ids: list.map((s: { id: string }) => s.id),
    });
    return NextResponse.json({
      sucursal_default_id: me?.sucursal_default_id ?? null,
      sucursales: list,
    });
  }

  const { data: asignadas, error: asgErr } = await db
    .from('usuario_sucursal')
    .select('sucursal:sucursal_id(id, codigo, nombre, activa, es_principal)')
    .eq('usuario_id', session.userId);

  if (asgErr) return NextResponse.json({ error: asgErr.message }, { status: 500 });

  type SucursalLista = {
    id: string;
    codigo?: string | null;
    nombre?: string | null;
    activa?: boolean | null;
    es_principal?: boolean | null;
  };

  type RowAsignada = { sucursal: SucursalLista | SucursalLista[] | null };
  let sucursales: SucursalLista[] = ((asignadas ?? []) as RowAsignada[])
    .map((r) => (Array.isArray(r.sucursal) ? r.sucursal[0] : r.sucursal))
    .filter((s): s is SucursalLista => Boolean(s && typeof s.id === 'string' && s.activa === true));

  const defRaw = me?.sucursal_default_id;
  const defId = typeof defRaw === 'string' ? defRaw.trim() : '';
  if (defId && !sucursales.some((s) => s.id === defId)) {
    const { data: sDef, error: defErr } = await db
      .from('sucursal')
      .select('id, codigo, nombre, activa, es_principal')
      .eq('id', defId)
      .eq('tenant_id', session.tenantId)
      .eq('activa', true)
      .maybeSingle();
    if (defErr) return NextResponse.json({ error: defErr.message }, { status: 500 });
    if (sDef && typeof (sDef as SucursalLista).id === 'string') {
      sucursales = [...sucursales, sDef as SucursalLista];
    }
  }

  if (sucursales.length === 0) {
    const { count, error: cntErr } = await db
      .from('sucursal')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', session.tenantId)
      .eq('activa', true);
    if (cntErr) return NextResponse.json({ error: cntErr.message }, { status: 500 });
    if ((count ?? 0) === 1) {
      const { data: solo, error: soloErr } = await db
        .from('sucursal')
        .select('id, codigo, nombre, activa, es_principal')
        .eq('tenant_id', session.tenantId)
        .eq('activa', true)
        .limit(1)
        .maybeSingle();
      if (soloErr) return NextResponse.json({ error: soloErr.message }, { status: 500 });
      if (solo && typeof (solo as SucursalLista).id === 'string') {
        sucursales = [solo as SucursalLista];
      }
    }
  }

  cajaServerDebug('sucursal-activa:GET', {
    canViewAll: false,
    userId: session.userId,
    rol: session.rol,
    sucursal_default_id: me?.sucursal_default_id ?? null,
    sucursales_count: sucursales.length,
    sucursal_ids: sucursales.map((s) => s.id),
  });

  return NextResponse.json({
    sucursal_default_id: me?.sucursal_default_id ?? null,
    sucursales,
  });
}

export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const db = session.supabase as any;

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
  const sucursalId = String(b.sucursal_id ?? '').trim();
  if (!sucursalId) {
    return NextResponse.json({ error: 'sucursal_id es obligatorio.' }, { status: 400 });
  }

  if (session.isSuperAdmin || session.rol === 'admin') {
    const { data: sucursal, error: findErr } = await db
      .from('sucursal')
      .select('id')
      .eq('id', sucursalId)
      .eq('tenant_id', session.tenantId)
      .eq('activa', true)
      .maybeSingle();
    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
    if (!sucursal) {
      return NextResponse.json({ error: 'Sucursal no encontrada o inactiva.' }, { status: 404 });
    }
  } else {
    const { data: allowed, error: scopeErr } = await db.rpc('usuario_puede_operar_sucursal', {
      p_sucursal_id: sucursalId,
    });
    if (scopeErr) return NextResponse.json({ error: scopeErr.message }, { status: 500 });
    if (!allowed) {
      return NextResponse.json({ error: 'No tenés permisos para esa sucursal.' }, { status: 403 });
    }
  }

  /**
   * Persistimos el default en `public.usuario`.
   * Usamos service role para evitar casos donde RLS/claims hagan que el UPDATE
   * quede en 0 filas sin error (y entonces, al recargar, vuelve a la principal).
   */
  const adminDb = createServiceRoleClient() as any;
  const { data: updated, error: updErr } = await adminDb
    .from('usuario')
    .update({ sucursal_default_id: sucursalId })
    .eq('id', session.userId)
    .eq('tenant_id', session.homeTenantId)
    .select('id, sucursal_default_id')
    .maybeSingle();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  if (!updated || (updated as { sucursal_default_id?: string | null }).sucursal_default_id !== sucursalId) {
    return NextResponse.json({ error: 'No se pudo persistir la sucursal activa.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sucursal_id: sucursalId });
}

