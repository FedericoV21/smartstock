import { NextResponse } from 'next/server';

import { rejectUnlessStockAjustar } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { revertirImportacionProductos } from '@/lib/importar/revertir-importacion-productos';
import { moduloGuard } from '@/lib/modulos/guard';

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: RouteCtx) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const permisoAjustar = await rejectUnlessStockAjustar(session.supabase, session);
  if (permisoAjustar) return permisoAjustar;

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'ID invalido' }, { status: 400 });
  }

  let motivo: string | undefined;
  try {
    const body = (await request.json()) as { motivo?: unknown };
    motivo = typeof body.motivo === 'string' ? body.motivo : undefined;
  } catch {
    motivo = undefined;
  }

  const result = await revertirImportacionProductos(
    session.supabase,
    { tenantId: session.tenantId, userId: session.userId },
    id,
    {
      sucursalId: sucursalScope.sucursalId,
      motivo,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, resumen: result.resumen });
}
