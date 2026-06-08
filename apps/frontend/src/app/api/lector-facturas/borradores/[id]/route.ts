import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import {
  datosExtraidosConPayloadBorrador,
  mapLectorFacturaBorradorListItem,
  metadataUpdateDesdePayload,
  payloadBorradorDesdeLog,
  validarPayloadBorradorLector,
  uuidOk,
} from '@/lib/lector-facturas/borradores-server';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { moduloGuardAny } from '@/lib/modulos/guard';

const SELECT_DETAIL = `
  id,
  tenant_id,
  usuario_id,
  archivo_nombre,
  archivo_mime,
  archivo_tamano,
  datos_extraidos,
  direccion,
  proveedor_id,
  cliente_id,
  created_at,
  updated_at,
  proveedor:proveedor_id ( nombre ),
  cliente:cliente_id ( nombre, razon_social ),
  usuario:usuario_id ( nombre, email )
`;

type RouteCtx = { params: Promise<{ id: string }> };

function esAdmin(session: { isSuperAdmin?: boolean; rol?: string }) {
  return Boolean(session.isSuperAdmin || session.rol === 'admin');
}

async function cargarBorrador(session: any, id: string) {
  if (!uuidOk(id)) {
    return { response: NextResponse.json({ error: 'ID invalido' }, { status: 400 }) };
  }

  const { data, error } = await (session.supabase as any)
    .from('lector_factura_log')
    .select(SELECT_DETAIL)
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('estado', 'extraido')
    .maybeSingle();

  if (error) {
    console.error('[lector-facturas/borradores/:id] get:', error.message);
    return { response: NextResponse.json({ error: 'No se pudo leer el borrador' }, { status: 500 }) };
  }
  if (!data) {
    return { response: NextResponse.json({ error: 'Borrador no encontrado' }, { status: 404 }) };
  }
  if (!esAdmin(session) && data.usuario_id !== session.userId) {
    return { response: NextResponse.json({ error: 'Sin permisos' }, { status: 403 }) };
  }
  return { data };
}

async function ivaDefaultTenant(session: any): Promise<number> {
  const { data } = await (session.supabase as any)
    .from('tenant')
    .select('iva_porcentaje_default')
    .eq('id', session.tenantId)
    .maybeSingle();
  const iva = data?.iva_porcentaje_default;
  return typeof iva === 'number' && Number.isFinite(iva) ? iva : 21;
}

export async function GET(_request: Request, ctx: RouteCtx) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await ctx.params;
  const loaded = await cargarBorrador(session, id);
  if ('response' in loaded) return loaded.response;

  const payload = payloadBorradorDesdeLog(loaded.data, await ivaDefaultTenant(session));
  return NextResponse.json({
    borrador: {
      ...mapLectorFacturaBorradorListItem(loaded.data),
      payload,
    },
  });
}

export async function PATCH(request: Request, ctx: RouteCtx) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await ctx.params;
  const loaded = await cargarBorrador(session, id);
  if ('response' in loaded) return loaded.response;

  let body: { payload?: unknown };
  try {
    body = (await request.json()) as { payload?: unknown };
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  let payload;
  try {
    payload = validarPayloadBorradorLector(body.payload);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  if (payload.extraccion.log_id !== id) {
    return NextResponse.json({ error: 'El borrador no coincide con la extraccion' }, { status: 400 });
  }

  const metadata = metadataUpdateDesdePayload(payload);
  const datos_extraidos = datosExtraidosConPayloadBorrador(loaded.data.datos_extraidos, payload);
  const { data, error } = await (session.supabase as any)
    .from('lector_factura_log')
    .update({
      datos_extraidos,
      direccion: metadata.direccion,
      proveedor_id: metadata.proveedor_id,
      cliente_id: metadata.cliente_id,
    })
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .select(SELECT_DETAIL)
    .single();

  if (error) {
    console.error('[lector-facturas/borradores/:id] patch:', error.message);
    return NextResponse.json({ error: 'No se pudo guardar el borrador' }, { status: 500 });
  }

  return NextResponse.json({ borrador: mapLectorFacturaBorradorListItem(data) });
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await ctx.params;
  const loaded = await cargarBorrador(session, id);
  if ('response' in loaded) return loaded.response;

  const { error } = await (session.supabase as any)
    .from('lector_factura_log')
    .update({ estado: 'descartado' })
    .eq('id', id)
    .eq('tenant_id', session.tenantId);

  if (error) {
    console.error('[lector-facturas/borradores/:id] delete:', error.message);
    return NextResponse.json({ error: 'No se pudo descartar el borrador' }, { status: 500 });
  }

  return NextResponse.json({});
}
