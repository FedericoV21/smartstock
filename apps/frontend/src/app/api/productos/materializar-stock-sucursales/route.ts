import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

/**
 * Crea filas `stock_sucursal` en 0 para cada producto activo del tenant en cada sucursal activa
 * donde aún no exista registro (misma semántica que el insert en lote al crear producto).
 * Solo **admin** (o super admin en contexto de tenant).
 */
export async function POST() {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  if (session.rol !== 'admin' && !session.isSuperAdmin) {
    return NextResponse.json(
      { error: 'Solo un administrador del negocio puede materializar stock en todas las sucursales.' },
      { status: 403 },
    );
  }

  const { data, error } = await session.supabase.rpc('materializar_stock_sucursales_faltantes', {
    p_tenant_id: session.tenantId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const insertados = typeof data === 'string' ? parseInt(data, 10) : Number(data);
  const n = Number.isFinite(insertados) ? insertados : 0;

  return NextResponse.json({
    insertados: n,
    mensaje:
      n === 0
        ? 'No había combinaciones faltantes: todos los productos activos ya tenían fila en cada sucursal activa.'
        : `Se crearon ${n} registro(s) en stock_sucursal (existencias en 0).`,
  });
}
