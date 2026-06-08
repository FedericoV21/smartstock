import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { apiErrorPayload } from '@/lib/errors/user-copy';
import { moduloGuard } from '@/lib/modulos/guard';

const TIPOS_FISCAL = [
  'factura_a',
  'factura_b',
  'factura_c',
  'nota_credito_a',
  'nota_credito_b',
  'nota_credito_c',
] as const;

/**
 * Cuenta comprobantes a resolver: todos los `error_arca` y `pendiente_arca` (banner dashboard).
 */
export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_arca');
  if (!guard.allowed) return NextResponse.json({ count: 0, disabled: true });

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  if (rejectIfVisor(session.rol)) {
    return NextResponse.json({ count: 0, disabled: true });
  }

  const scope = await resolveAndValidateSucursalScope(
    session,
    new URL(request.url).searchParams.get('sucursal_id')?.trim() || null,
  );
  if (!scope.ok) return scope.response;

  let q = session.supabase
    .from('comprobante')
    .select('estado, intentos_arca')
    .eq('tenant_id', session.tenantId)
    .in('tipo', [...TIPOS_FISCAL])
    .in('estado', ['error_arca', 'pendiente_arca'])
    .limit(500);

  if (scope.sucursalId) {
    q = q.eq('sucursal_id', scope.sucursalId);
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json(
      apiErrorPayload(
        'arca',
        error.message,
        'No pudimos consultar el estado del centro de errores fiscales.',
      ),
      { status: 500 },
    );
  }

  const count = (data ?? []).length;

  return NextResponse.json({ count });
}
