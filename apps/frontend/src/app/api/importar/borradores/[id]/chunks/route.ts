import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import {
  normalizarFilasBorrador,
  puedeAccederBorrador,
  reemplazarChunksBorrador,
  uuidOk,
} from '@/lib/importar/borradores-server';
import { moduloGuardAny } from '@/lib/modulos/guard';

type RouteCtx = { params: Promise<{ id: string }> };

async function cargarBorrador(session: any, id: string) {
  if (!uuidOk(id)) {
    return { response: NextResponse.json({ error: 'ID invalido' }, { status: 400 }) };
  }
  const { data, error } = await (session.supabase as any)
    .from('importacion_borrador')
    .select('id, tenant_id, usuario_id')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('estado', 'activo')
    .maybeSingle();
  if (error) {
    return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
  }
  if (!data) {
    return { response: NextResponse.json({ error: 'Borrador no encontrado' }, { status: 404 }) };
  }
  if (!puedeAccederBorrador(session, data)) {
    return { response: NextResponse.json({ error: 'Sin permisos' }, { status: 403 }) };
  }
  return { data };
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const guard = await moduloGuardAny(['importador_excel', 'ia_precios']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await ctx.params;
  const loaded = await cargarBorrador(session, id);
  if ('response' in loaded) return loaded.response;

  let body: { filas?: unknown };
  try {
    body = (await request.json()) as { filas?: unknown };
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const filas = normalizarFilasBorrador(body.filas);
  try {
    await reemplazarChunksBorrador(session.supabase as any, id, filas);
    const { error: updErr } = await (session.supabase as any)
      .from('importacion_borrador')
      .update({ total_filas: filas.length })
      .eq('id', id)
      .eq('tenant_id', session.tenantId);
    if (updErr) throw new Error(updErr.message);
  } catch (e) {
    console.error('[importar/borradores/:id/chunks]', (e as Error).message);
    return NextResponse.json({ error: 'No se pudieron guardar las filas' }, { status: 500 });
  }

  return NextResponse.json({});
}
