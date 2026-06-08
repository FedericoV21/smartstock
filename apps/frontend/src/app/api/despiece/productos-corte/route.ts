import { NextResponse } from 'next/server';

import { rejectUnlessDespieceVer } from '@/lib/api/permissions';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuardDespieceConNegocio } from '@/lib/modulos/guard';
import { normalizarTextoBusqueda } from '@/lib/search/normalize-busqueda';

export async function GET(request: Request) {
  const guard = await moduloGuardDespieceConNegocio();
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await rejectUnlessDespieceVer(session.supabase, session);
  if (forbidden) return forbidden;

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const qNormalizado = q ? normalizarTextoBusqueda(q) : '';

  let query = session.supabase
    .from('producto')
    .select('id, codigo, nombre, precio_costo, precio_venta, unidad, plu, es_pesable, activo')
    .eq('tenant_id', session.tenantId)
    .eq('activo', true)
    .eq('es_pesable', true)
    .in('unidad', ['kg', 'gramo'])
    .order('nombre', { ascending: true })
    .limit(50);

  if (qNormalizado) {
    query = query.ilike('texto_buscable', `%${qNormalizado}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ productos: data ?? [] });
}
