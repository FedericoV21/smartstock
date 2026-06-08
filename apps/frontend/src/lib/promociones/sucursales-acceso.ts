import { NextResponse } from 'next/server';

import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import type { TenantSession } from '@/lib/api/tenant-session';

type SessionOk = Exclude<TenantSession, { error: NextResponse }>;

export async function validarSucursalIdsAccesoPromocion(
  session: SessionOk,
  requestedSucursalIds: string[],
  fallbackSucursalId: string,
): Promise<{ ok: true; ids: string[] } | { ok: false; response: NextResponse }> {
  const ids = [
    ...new Set(
      (requestedSucursalIds.length > 0 ? requestedSucursalIds : [fallbackSucursalId])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean),
    ),
  ];

  if (ids.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Selecciona al menos una sucursal para la promocion.' },
        { status: 400 },
      ),
    };
  }

  const operables = await idsSucursalesOperables(session);
  if (!operables.ok) return operables;
  if (operables.ids.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'No tenes sucursales operables para asignar promociones.' },
        { status: 403 },
      ),
    };
  }

  const operablesSet = new Set(operables.ids);
  const invalid = ids.filter((id) => !operablesSet.has(id));
  if (invalid.length > 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Solo podes asignar la promocion a sucursales donde tenes acceso.' },
        { status: 403 },
      ),
    };
  }

  return { ok: true, ids };
}

export function promoVisibleEnSucursal(
  promoSucursalId: string | null | undefined,
  accessSucursalIds: string[],
  currentSucursalId: string,
): boolean {
  return promoSucursalId === currentSucursalId || accessSucursalIds.includes(currentSucursalId);
}
