import { NextResponse, type NextRequest } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import {
  esAdminBorradores,
  mapBorradorListItem,
  metadataDesdePayload,
  normalizarFlujo,
  validarPayloadBorrador,
} from '@/lib/importar/borradores-server';
import { moduloGuardAny } from '@/lib/modulos/guard';

const SELECT_LIST = `
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
  proveedor:proveedor_id ( nombre ),
  sucursal:sucursal_id ( nombre ),
  usuario:usuario_id ( nombre, email ),
  importacion_borrador_archivo ( borrador_id )
`;

export async function GET(request: NextRequest) {
  const guard = await moduloGuardAny(['importador_excel', 'ia_precios']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { searchParams } = new URL(request.url);
  const flujo = normalizarFlujo(searchParams.get('flujo'));
  const limit = Math.min(80, Math.max(1, Number.parseInt(searchParams.get('limit') ?? '40', 10)));
  const db = session.supabase as any;

  let q = db
    .from('importacion_borrador')
    .select(SELECT_LIST)
    .eq('tenant_id', session.tenantId)
    .eq('estado', 'activo')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (flujo) q = q.eq('flujo', flujo);
  if (!esAdminBorradores(session)) q = q.eq('usuario_id', session.userId);

  const { data, error } = await q;
  if (error) {
    console.error('[importar/borradores] list:', error.message);
    return NextResponse.json({ error: 'No se pudieron cargar los borradores' }, { status: 500 });
  }

  return NextResponse.json({ borradores: (data ?? []).map(mapBorradorListItem) });
}

export async function POST(request: Request) {
  const guard = await moduloGuardAny(['importador_excel', 'ia_precios']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

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

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const db = session.supabase as any;
  const { data, error } = await db
    .from('importacion_borrador')
    .insert({
      tenant_id: session.tenantId,
      usuario_id: session.userId,
      sucursal_id: sucursalScope.sucursalId,
      ...metadataDesdePayload(payload),
    })
    .select(SELECT_LIST)
    .single();

  if (error) {
    console.error('[importar/borradores] create:', error.message);
    return NextResponse.json({ error: 'No se pudo guardar el borrador' }, { status: 500 });
  }

  return NextResponse.json({ borrador: mapBorradorListItem(data) });
}
