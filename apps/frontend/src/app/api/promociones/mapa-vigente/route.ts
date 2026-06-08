import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { cargarMapaPromocionesVigentes } from '@/lib/promociones/cargar-mapa';
import { hoyEnAR } from '@/lib/utils/formatters';
import type { PromocionMotor } from '@/types/promociones';

const MAX_IDS = 400;

export async function POST(request: Request) {
  const guard = await moduloGuardAny(['facturador_pos', 'facturador_simple', 'presupuestos']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const bodyRecord =
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const rawSolicitada =
    typeof bodyRecord?.sucursal_id === 'string' ? bodyRecord.sucursal_id.trim() : '';
  const sucursalScope = await resolveAndValidateSucursalScope(session, rawSolicitada || null);
  if (!sucursalScope.ok) return sucursalScope.response;

  const raw = bodyRecord?.producto_ids;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: 'producto_ids debe ser un array' }, { status: 400 });
  }

  const producto_ids = [
    ...new Set(
      raw.filter((x): x is string => typeof x === 'string' && x.length > 0),
    ),
  ].slice(0, MAX_IDS);

  const fecha = hoyEnAR();
  if (producto_ids.length === 0) {
    return NextResponse.json({ fecha, mapa: {} as Record<string, PromocionMotor> });
  }

  try {
    const map = await cargarMapaPromocionesVigentes(
      session.supabase,
      session.tenantId,
      producto_ids,
      fecha,
      sucursalScope.sucursalId,
    );
    const mapa: Record<string, PromocionMotor> = {};
    for (const [k, v] of map) {
      mapa[k] = v;
    }
    return NextResponse.json({ fecha, mapa });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
