import { NextResponse, type NextRequest } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: NextRequest) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '80', 10)));

  const sucursalScope = await resolveAndValidateSucursalScope(session, searchParams.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const fechaDesde = searchParams.get('desde')?.trim() ?? '';
  const fechaHasta = searchParams.get('hasta')?.trim() ?? '';
  const ymdOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const proveedorRaw = searchParams.get('proveedor_id')?.trim() ?? '';
  const uuidProveedorOk = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

  const sid = sucursalScope.sucursalId;
  let q = session.supabase
    .from('importacion_log')
    .select(
      `
      id,
      created_at,
      archivo_nombre,
      origen,
      total_filas,
      filas_exitosas,
      filas_con_error,
      productos_creados,
      productos_actualizados,
      detalle_errores,
      proveedor_id,
      usuario_id,
      sucursal_id,
      carga_id,
      archivo_storage_path,
      archivo_mime,
      archivo_tamano,
      estado,
      revertida_at,
      revertida_por,
      motivo_reversion,
      resumen_reversion,
      proveedor ( nombre ),
      sucursal ( id, nombre )
    `,
    )
    .eq('tenant_id', session.tenantId)
    .or(`sucursal_id.eq.${sid},sucursal_id.is.null`);

  if (ymdOk(fechaDesde)) {
    q = q.gte('created_at', `${fechaDesde}T00:00:00.000Z`);
  }
  if (ymdOk(fechaHasta)) {
    q = q.lte('created_at', `${fechaHasta}T23:59:59.999Z`);
  }

  if (proveedorRaw === '__sin__') {
    q = q.is('proveedor_id', null);
  } else if (uuidProveedorOk(proveedorRaw)) {
    q = q.eq('proveedor_id', proveedorRaw);
  }

  q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);

  const { data, error } = await q;

  if (error) {
    console.error('[importar/logs]', error.message);
    return NextResponse.json({ error: 'No se pudo cargar el historial' }, { status: 500 });
  }

  const logsRaw = data ?? [];
  const cargaIds = [
    ...new Set(
      logsRaw
        .map((r) => r.carga_id)
        .filter((c): c is string => typeof c === 'string' && /^[0-9a-f-]{36}$/i.test(c.trim())),
    ),
  ];

  const dbCargas = new Set<string>();
  if (cargaIds.length > 0) {
    const { data: archRows, error: archErr } = await session.supabase
      .from('importacion_archivo')
      .select('carga_id')
      .eq('tenant_id', session.tenantId)
      .in('carga_id', cargaIds);
    if (archErr) {
      console.error('[importar/logs] importacion_archivo:', archErr.message);
    } else {
      for (const r of archRows ?? []) {
        if (typeof r.carga_id === 'string') dbCargas.add(r.carga_id);
      }
    }
  }

  const logs = logsRaw.map((r) => ({
    ...r,
    archivo_db_disponible:
      typeof r.carga_id === 'string' && /^[0-9a-f-]{36}$/i.test(r.carga_id) && dbCargas.has(r.carga_id),
  }));

  return NextResponse.json({ logs });
}
