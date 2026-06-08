import { NextResponse, type NextRequest } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import {
  esAdminBorradoresLector,
  mapLectorFacturaBorradorListItem,
} from '@/lib/lector-facturas/borradores-server';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { moduloGuardAny } from '@/lib/modulos/guard';

const SELECT_LIST = `
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

export async function GET(request: NextRequest) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(80, Math.max(1, Number.parseInt(searchParams.get('limit') ?? '40', 10)));
  const db = session.supabase as any;

  let q = db
    .from('lector_factura_log')
    .select(SELECT_LIST)
    .eq('tenant_id', session.tenantId)
    .eq('estado', 'extraido')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (!esAdminBorradoresLector(session)) q = q.eq('usuario_id', session.userId);

  const { data, error } = await q;
  if (error) {
    console.error('[lector-facturas/borradores] list:', error.message);
    return NextResponse.json({ error: 'No se pudieron cargar los borradores' }, { status: 500 });
  }

  return NextResponse.json({ borradores: (data ?? []).map(mapLectorFacturaBorradorListItem) });
}
