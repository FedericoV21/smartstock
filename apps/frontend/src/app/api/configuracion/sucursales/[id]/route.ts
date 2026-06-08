import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession } from '@/lib/api/tenant-session';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const db = createServiceRoleClient() as any;

  const hasBranchPermission = await hasPermission(session.supabase, 'sucursales.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const canManageBranches = session.isSuperAdmin || session.rol === 'admin' || hasBranchPermission;
  if (!canManageBranches) {
    return NextResponse.json({ error: 'Sin permisos para gestionar sucursales.' }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const updates: Record<string, unknown> = {};

  if (typeof b.codigo === 'string') updates.codigo = b.codigo.trim();
  if (typeof b.nombre === 'string') updates.nombre = b.nombre.trim();
  if (typeof b.direccion === 'string' || b.direccion === null) updates.direccion = b.direccion;
  if (typeof b.activa === 'boolean') updates.activa = b.activa;
  if (typeof b.hereda_datos_ticket === 'boolean') updates.hereda_datos_ticket = b.hereda_datos_ticket;
  if (typeof b.razon_social === 'string' || b.razon_social === null) updates.razon_social = b.razon_social;
  if (typeof b.cuit === 'string' || b.cuit === null) updates.cuit = b.cuit;
  if (typeof b.telefono === 'string' || b.telefono === null) updates.telefono = b.telefono;
  if (typeof b.horarios_atencion === 'string' || b.horarios_atencion === null) {
    updates.horarios_atencion = b.horarios_atencion;
  }
  if (typeof b.email === 'string' || b.email === null) updates.email = b.email;

  if (b.hereda_datos_ticket === true) {
    updates.hereda_datos_ticket = true;
    updates.razon_social = null;
    updates.cuit = null;
    updates.telefono = null;
    updates.horarios_atencion = null;
    updates.email = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Sin cambios.' }, { status: 400 });
  }

  const { data, error } = await db
    .from('sucursal')
    .update(updates as Database['public']['Tables']['sucursal']['Update'])
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .select(
      'id, codigo, nombre, direccion, activa, es_principal, created_at, hereda_datos_ticket, razon_social, cuit, telefono, horarios_atencion, email',
    )
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Sucursal no encontrada.' }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}

function devLogSucursalDelete(label: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[api DELETE sucursales/[id]] ${label}`, payload);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) {
    devLogSucursalDelete('sesión inválida', {});
    return session.error;
  }
  const db = createServiceRoleClient() as any;

  const hasBranchPermission = await hasPermission(session.supabase, 'sucursales.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const canManageBranches = session.isSuperAdmin || session.rol === 'admin' || hasBranchPermission;
  if (!canManageBranches) {
    devLogSucursalDelete('403 sin permiso sucursales.gestionar', {
      rol: session.rol,
      isSuperAdmin: session.isSuperAdmin,
      hasBranchPermission,
    });
    return NextResponse.json({ error: 'Sin permisos para gestionar sucursales.' }, { status: 403 });
  }

  const { id } = await params;
  devLogSucursalDelete('buscando sucursal', { sucursalId: id, tenantId: session.tenantId });

  const { data: sucursal, error: findErr } = await db
    .from('sucursal')
    .select('id, es_principal')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (findErr || !sucursal) {
    devLogSucursalDelete('404 no encontrada o error de lectura', {
      findErr: findErr
        ? { message: findErr.message, code: findErr.code, details: findErr.details, hint: findErr.hint }
        : null,
      tieneData: Boolean(sucursal),
    });
    return NextResponse.json({ error: 'Sucursal no encontrada.' }, { status: 404 });
  }
  if (sucursal.es_principal) {
    devLogSucursalDelete('400 es principal', { id: sucursal.id });
    return NextResponse.json(
      { error: 'No podés eliminar la sucursal principal.' },
      { status: 400 },
    );
  }

  devLogSucursalDelete('ejecutando delete en DB', { id });
  const { error } = await db
    .from('sucursal')
    .delete()
    .eq('id', id)
    .eq('tenant_id', session.tenantId);

  if (error) {
    devLogSucursalDelete('error al borrar', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  devLogSucursalDelete('ok', { id });
  return NextResponse.json({ success: true });
}

