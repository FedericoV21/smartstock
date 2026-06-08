import type { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import type { TenantSession } from '@/lib/api/tenant-session';

type SessionOk = Exclude<TenantSession, { error: NextResponse }>;

/** Alta/edición de filas en `public.caja` (estructura por sucursal). */
export async function puedeGestionarEstructuraCajas(session: SessionOk): Promise<boolean> {
  if (session.isSuperAdmin || session.rol === 'admin') return true;
  return hasPermission(session.supabase, 'sucursales.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
}
