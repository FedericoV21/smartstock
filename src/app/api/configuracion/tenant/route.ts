import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import type { Database } from '@/types/database';

export async function GET() {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { data, error } = await session.supabase
    .from('tenant')
    .select(
      'id, nombre, razon_social, cuit, domicilio, telefono, email, horarios_atencion, condicion_iva, punto_de_venta, plan, logo_url',
    )
    .eq('id', session.tenantId)
    .single();

  if (error || !data) {
    if (error) {
      console.error('[GET /api/configuracion/tenant]', error.message, error.code);
    }
    return NextResponse.json(
      {
        error: 'Tenant no encontrado',
        ...(process.env.NODE_ENV === 'development' && error
          ? { debug: { message: error.message, code: error.code, hint: error.hint } }
          : {}),
      },
      { status: 500 },
    );
  }

  let arca_configurado = false;
  const { data: moduloRow } = await session.supabase
    .from('modulo_config')
    .select('facturador_arca')
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  const arcaModuloActivo = !!(moduloRow && (moduloRow as { facturador_arca?: boolean }).facturador_arca);

  if (arcaModuloActivo) {
    const { data: arcaRow } = await session.supabase
      .from('arca_config')
      .select('certificado_pem, clave_privada_pem, cuit_emisor, punto_de_venta')
      .eq('tenant_id', session.tenantId)
      .maybeSingle();

    arca_configurado = !!(
      arcaRow?.certificado_pem &&
      arcaRow?.clave_privada_pem &&
      arcaRow?.cuit_emisor &&
      arcaRow?.punto_de_venta != null
    );
  }

  return NextResponse.json({ ...data, arca_configurado });
}

export async function PATCH(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  if (session.rol !== 'admin') {
    return NextResponse.json(
      { error: 'Solo el administrador puede editar los datos del negocio' },
      { status: 403 },
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

  const updates: Record<string, unknown> = {};
  const str = (v: unknown) =>
    v === null || v === undefined ? null : String(v).trim() || null;

  if (b.nombre !== undefined) updates.nombre = String(b.nombre ?? '').trim();
  if (b.razon_social !== undefined) updates.razon_social = str(b.razon_social);
  if (b.cuit !== undefined) updates.cuit = str(b.cuit);
  if (b.domicilio !== undefined) updates.domicilio = str(b.domicilio);
  if (b.telefono !== undefined) updates.telefono = str(b.telefono);
  if (b.horarios_atencion !== undefined) updates.horarios_atencion = str(b.horarios_atencion);
  if (b.email !== undefined) updates.email = str(b.email);
  if (b.condicion_iva !== undefined) updates.condicion_iva = b.condicion_iva;
  if (b.punto_de_venta !== undefined)
    updates.punto_de_venta = Number(b.punto_de_venta) || 1;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });
  }

  if (updates.nombre === '') {
    return NextResponse.json(
      { error: 'El nombre del negocio no puede estar vacío' },
      { status: 400 },
    );
  }

  const { data, error } = await session.supabase
    .from('tenant')
    .update(updates as Database['public']['Tables']['tenant']['Update'])
    .eq('id', session.tenantId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}
