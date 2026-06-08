import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { getTenantSession } from '@/lib/api/tenant-session';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET() {
  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const db = createServiceRoleClient() as any;

  const { data, error } = await db
    .from('sucursal')
    .select(
      'id, codigo, nombre, direccion, activa, es_principal, created_at, hereda_datos_ticket, razon_social, cuit, telefono, horarios_atencion, email',
    )
    .eq('tenant_id', session.tenantId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sucursales: data ?? [] });
}

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const codigo = String(b.codigo ?? '').trim();
  const nombre = String(b.nombre ?? '').trim();
  const direccion = b.direccion == null ? null : String(b.direccion).trim();
  const activa = typeof b.activa === 'boolean' ? b.activa : true;
  const perfilTicket = String(b.perfil_ticket ?? 'copiar_negocio').trim();
  const perfilOk = perfilTicket === 'copiar_negocio' || perfilTicket === 'personalizar_vacio';
  if (!perfilOk) {
    return NextResponse.json(
      { error: 'perfil_ticket debe ser copiar_negocio o personalizar_vacio.' },
      { status: 400 },
    );
  }

  if (!codigo || !nombre) {
    return NextResponse.json({ error: 'Código y nombre son obligatorios.' }, { status: 400 });
  }

  const insertRow: Record<string, unknown> = {
    tenant_id: session.tenantId,
    codigo,
    nombre,
    direccion,
    activa,
    es_principal: false,
  };

  if (perfilTicket === 'personalizar_vacio') {
    insertRow.hereda_datos_ticket = false;
  } else {
    const { data: tRow, error: tErr } = await db
      .from('tenant')
      .select('razon_social, cuit, telefono, horarios_atencion, email')
      .eq('id', session.tenantId)
      .single();
    if (tErr || !tRow) {
      return NextResponse.json({ error: tErr?.message ?? 'Tenant no encontrado.' }, { status: 500 });
    }
    insertRow.hereda_datos_ticket = false;
    insertRow.razon_social = (tRow as { razon_social?: string | null }).razon_social ?? null;
    insertRow.cuit = (tRow as { cuit?: string | null }).cuit ?? null;
    insertRow.telefono = (tRow as { telefono?: string | null }).telefono ?? null;
    insertRow.horarios_atencion = (tRow as { horarios_atencion?: string | null }).horarios_atencion ?? null;
    insertRow.email = (tRow as { email?: string | null }).email ?? null;
  }

  const { data, error } = await db
    .from('sucursal')
    .insert(insertRow as any)
    .select(
      'id, codigo, nombre, direccion, activa, es_principal, created_at, hereda_datos_ticket, razon_social, cuit, telefono, horarios_atencion, email',
    )
    .single();

  if (error) {
    const isConflict = String(error.code) === '23505';
    return NextResponse.json(
      { error: isConflict ? 'Ya existe una sucursal con ese código o nombre.' : error.message },
      { status: isConflict ? 409 : 400 },
    );
  }

  return NextResponse.json(data, { status: 201 });
}

