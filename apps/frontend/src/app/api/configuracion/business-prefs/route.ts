import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession } from '@/lib/api/tenant-session';
import {
  effectiveBusinessPrefsFromRows,
  isBusinessPrefsPayload,
  mergeBusinessPrefsOverride,
  normalizeBusinessPrefs,
  type BusinessPrefs,
} from '@/lib/business-prefs/prefs';
import { syncTesoreriaOnBusinessPrefsChange } from '@/lib/tesoreria/resolve-caja';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

/**
 * GET:
 *   - Sin `for_config`: devuelve las prefs efectivas para la sucursal pedida (o defaults del tenant).
 *   - `for_config=1`: pantalla de configuración. Sin `sucursal_id` = solo defaults del tenant;
 *     con `sucursal_id` = merge de esa sucursal.
 *
 * PATCH:
 *   - `{ scope: 'tenant', business_prefs }` — admin o super admin.
 *   - `{ sucursal_id, business_prefs }` — admin o permiso `sucursales.gestionar`.
 *   - `{ sucursal_id, inherit_from_tenant: true }` — borra prefs de sucursal (hereda).
 */

export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const url = new URL(request.url);
  const forConfig = url.searchParams.get('for_config') === '1';
  const requestedSucursalId = url.searchParams.get('sucursal_id')?.trim() || null;

  const db = createServiceRoleClient() as ReturnType<typeof createServiceRoleClient>;

  const { data: tenantRow, error: tErr } = await db
    .from('tenant')
    .select('business_prefs')
    .eq('id', session.tenantId)
    .single();
  if (tErr || !tenantRow) {
    return NextResponse.json({ error: tErr?.message ?? 'Tenant no encontrado' }, { status: 500 });
  }

  const tenantPrefsRaw = (tenantRow as { business_prefs: unknown }).business_prefs;
  const tenantNorm = normalizeBusinessPrefs(tenantPrefsRaw);

  let sucursalPrefsRaw: unknown | null = null;
  let outSucursalId: string | null = null;

  if (forConfig) {
    if (requestedSucursalId) {
      const { data: sRow, error: sErr } = await db
        .from('sucursal')
        .select('id, business_prefs')
        .eq('id', requestedSucursalId)
        .eq('tenant_id', session.tenantId)
        .maybeSingle();
      if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
      if (!sRow) return NextResponse.json({ error: 'Sucursal no encontrada.' }, { status: 404 });
      outSucursalId = requestedSucursalId;
      sucursalPrefsRaw = (sRow as { business_prefs: unknown }).business_prefs ?? null;
    }
  } else if (requestedSucursalId) {
    const { data: sRow, error: sErr } = await db
      .from('sucursal')
      .select('id, business_prefs')
      .eq('id', requestedSucursalId)
      .eq('tenant_id', session.tenantId)
      .maybeSingle();
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
    if (sRow) {
      outSucursalId = requestedSucursalId;
      sucursalPrefsRaw = (sRow as { business_prefs: unknown }).business_prefs ?? null;
    }
  }

  const effective = effectiveBusinessPrefsFromRows(tenantPrefsRaw, sucursalPrefsRaw);

  return NextResponse.json({
    sucursal_id: outSucursalId,
    tenant_business_prefs: tenantNorm,
    sucursal_business_prefs: outSucursalId ? sucursalPrefsRaw : null,
    effective_business_prefs: effective,
  });
}

export async function PATCH(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const db = createServiceRoleClient() as ReturnType<typeof createServiceRoleClient>;

  if (b.scope === 'tenant') {
    if (session.rol !== 'admin' && !session.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Solo el administrador puede editar los defaults del negocio.' },
        { status: 403 },
      );
    }
    if (!isBusinessPrefsPayload(b.business_prefs)) {
      return NextResponse.json({ error: 'business_prefs inválido.' }, { status: 400 });
    }
    const normalized = normalizeBusinessPrefs(b.business_prefs as Partial<BusinessPrefs>);
    const { error } = await db
      .from('tenant')
      .update({
        business_prefs: normalized as unknown as Database['public']['Tables']['tenant']['Update']['business_prefs'],
      })
      .eq('id', session.tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const sync = await syncTesoreriaOnBusinessPrefsChange(db, session.tenantId, normalized);
    if (!sync.ok) return NextResponse.json({ error: sync.error }, { status: 500 });
    return NextResponse.json({ ok: true, business_prefs: normalized });
  }

  const sucursalId = typeof b.sucursal_id === 'string' ? b.sucursal_id.trim() : '';
  if (!sucursalId) {
    return NextResponse.json(
      { error: 'Usá scope "tenant" + business_prefs, o sucursal_id + business_prefs / inherit_from_tenant.' },
      { status: 400 },
    );
  }

  const hasBranchPermission = await hasPermission(session.supabase, 'sucursales.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const canManageBranches = session.isSuperAdmin || session.rol === 'admin' || hasBranchPermission;
  if (!canManageBranches) {
    return NextResponse.json({ error: 'Sin permisos para editar sucursales.' }, { status: 403 });
  }

  const { data: sucursal, error: findErr } = await db
    .from('sucursal')
    .select('id, tenant_id')
    .eq('id', sucursalId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (findErr || !sucursal) {
    return NextResponse.json({ error: 'Sucursal no encontrada.' }, { status: 404 });
  }

  if (b.inherit_from_tenant === true) {
    const { error } = await db.from('sucursal').update({ business_prefs: null }).eq('id', sucursalId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, business_prefs: null });
  }

  if (!isBusinessPrefsPayload(b.business_prefs)) {
    return NextResponse.json({ error: 'business_prefs inválido.' }, { status: 400 });
  }

  const { data: tenantRow } = await db
    .from('tenant')
    .select('business_prefs')
    .eq('id', session.tenantId)
    .single();
  const tenantNorm = normalizeBusinessPrefs((tenantRow as { business_prefs: unknown } | null)?.business_prefs);
  const merged = mergeBusinessPrefsOverride(tenantNorm, b.business_prefs as Partial<BusinessPrefs>);

  const sameAsTenant = JSON.stringify(merged) === JSON.stringify(tenantNorm);
  const valueToStore = sameAsTenant ? null : merged;

  const { error } = await db
    .from('sucursal')
    .update({
      business_prefs: valueToStore as unknown as Database['public']['Tables']['sucursal']['Update']['business_prefs'],
    })
    .eq('id', sucursalId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, business_prefs: valueToStore });
}
