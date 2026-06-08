import { NextResponse } from 'next/server';

import { rejectUnlessTesoreriaGestionar } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  ensureTesoreriaHabilitada,
  fetchSaldoEfectivoTesoreria,
  resolveCajaTesoreriaActiva,
} from '@/lib/tesoreria/resolve-caja';

export type TesoreriaApiContext = {
  session: Exclude<Awaited<ReturnType<typeof getTenantSession>>, { error: NextResponse }>;
  db: ReturnType<typeof createServiceRoleClient>;
  sucursalId: string | null;
  cajaTesoreriaId: string;
  saldoEfectivo: number;
};

export async function withTesoreriaApi(
  request: Request,
  handler: (ctx: TesoreriaApiContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const denied = await rejectUnlessTesoreriaGestionar(session.supabase, session);
  if (denied) return denied;

  const url = new URL(request.url);
  const scope = await resolveAndValidateSucursalScope(session, url.searchParams.get('sucursal_id'));
  if (!scope.ok) return scope.response;

  const db = createServiceRoleClient();
  const enabled = await ensureTesoreriaHabilitada(db, session.tenantId, scope.sucursalId);
  if (!enabled.ok) {
    return NextResponse.json({ error: enabled.error }, { status: enabled.status });
  }

  const cajaRes = await resolveCajaTesoreriaActiva(
    db,
    session.tenantId,
    enabled.prefs,
    enabled.prefs.cajaInterna.alcance === 'sucursal' ? scope.sucursalId : null,
  );
  if (!cajaRes.ok) {
    return NextResponse.json({ error: cajaRes.error }, { status: cajaRes.status });
  }

  let saldoEfectivo = 0;
  try {
    saldoEfectivo = await fetchSaldoEfectivoTesoreria(db, cajaRes.caja.id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al calcular saldo' },
      { status: 500 },
    );
  }

  return handler({
    session,
    db,
    sucursalId: scope.sucursalId,
    cajaTesoreriaId: cajaRes.caja.id,
    saldoEfectivo,
  });
}
