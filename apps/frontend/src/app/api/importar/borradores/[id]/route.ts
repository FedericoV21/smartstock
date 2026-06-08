import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import {
  leerFilasBorrador,
  mapBorradorListItem,
  metadataDesdePayload,
  puedeAccederBorrador,
  validarPayloadBorrador,
  uuidOk,
} from '@/lib/importar/borradores-server';
import { moduloGuardAny } from '@/lib/modulos/guard';

const SELECT_DETAIL = `
  id,
  flujo,
  paso,
  origen,
  archivo_nombre,
  archivo_mime,
  archivo_tamano,
  total_filas,
  proveedor_id,
  sucursal_id,
  usuario_id,
  created_at,
  updated_at,
  payload,
  proveedor:proveedor_id ( nombre ),
  sucursal:sucursal_id ( nombre ),
  usuario:usuario_id ( nombre, email ),
  importacion_borrador_archivo ( borrador_id )
`;

type RouteCtx = { params: Promise<{ id: string }> };

async function cargarBorrador(
  session: Exclude<Awaited<ReturnType<typeof getTenantSession>>, { error: NextResponse }>,
  id: string,
) {
  if (!uuidOk(id)) {
    return { response: NextResponse.json({ error: 'ID invalido' }, { status: 400 }) };
  }

  const { data, error } = await (session.supabase as any)
    .from('importacion_borrador')
    .select(SELECT_DETAIL)
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('estado', 'activo')
    .maybeSingle();

  if (error) {
    console.error('[importar/borradores/:id] get:', error.message);
    return { response: NextResponse.json({ error: 'No se pudo leer el borrador' }, { status: 500 }) };
  }
  if (!data) {
    return { response: NextResponse.json({ error: 'Borrador no encontrado' }, { status: 404 }) };
  }
  if (!puedeAccederBorrador(session, data)) {
    return { response: NextResponse.json({ error: 'Sin permisos' }, { status: 403 }) };
  }
  return { data };
}

export async function GET(_request: Request, ctx: RouteCtx) {
  const guard = await moduloGuardAny(['importador_excel', 'ia_precios']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await ctx.params;
  const loaded = await cargarBorrador(session, id);
  if ('response' in loaded) return loaded.response;

  try {
    const filas = await leerFilasBorrador(session.supabase as any, id);
    return NextResponse.json({
      borrador: {
        ...mapBorradorListItem(loaded.data),
        payload: loaded.data.payload,
        filas,
      },
    });
  } catch (e) {
    console.error('[importar/borradores/:id] chunks:', (e as Error).message);
    return NextResponse.json({ error: 'No se pudieron leer las filas' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: RouteCtx) {
  const guard = await moduloGuardAny(['importador_excel', 'ia_precios']);
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
    payload = validarPayloadBorrador(body.payload);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const { data, error } = await (session.supabase as any)
    .from('importacion_borrador')
    .update(metadataDesdePayload(payload))
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .select(SELECT_DETAIL)
    .single();

  if (error) {
    console.error('[importar/borradores/:id] patch:', error.message);
    return NextResponse.json({ error: 'No se pudo actualizar el borrador' }, { status: 500 });
  }

  return NextResponse.json({ borrador: mapBorradorListItem(data) });
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const guard = await moduloGuardAny(['importador_excel', 'ia_precios']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await ctx.params;
  const loaded = await cargarBorrador(session, id);
  if ('response' in loaded) return loaded.response;

  const { error } = await (session.supabase as any)
    .from('importacion_borrador')
    .delete()
    .eq('id', id)
    .eq('tenant_id', session.tenantId);

  if (error) {
    console.error('[importar/borradores/:id] delete:', error.message);
    return NextResponse.json({ error: 'No se pudo borrar el borrador' }, { status: 500 });
  }

  return NextResponse.json({});
}
