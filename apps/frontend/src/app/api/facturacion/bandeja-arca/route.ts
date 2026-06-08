import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { apiErrorPayload } from '@/lib/errors/user-copy';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_arca');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const sp = new URL(request.url).searchParams;
  const scope = await resolveAndValidateSucursalScope(
    session,
    String(sp.get('sucursal_id') ?? '').trim() || null,
  );
  if (!scope.ok) return scope.response;

  const tiposFiscales = [
    'factura_a',
    'factura_b',
    'factura_c',
    'nota_credito_a',
    'nota_credito_b',
    'nota_credito_c',
  ] as const;

  let query = session.supabase
    .from('comprobante')
    .select(
      'id, tipo, estado, total, numero_orden, created_at, intentos_arca, ultimo_error_arca_codigo, ultimo_error_arca_mensaje, ultimo_intento_arca_at, pdf_url, cliente:cliente_id ( id, nombre, razon_social, cuit_dni, documento_fiscal_tipo, telefono )',
    )
    .eq('tenant_id', session.tenantId)
    .in('tipo', [...tiposFiscales])
    .in('estado', ['error_arca', 'pendiente_arca'])
    .order('ultimo_intento_arca_at', { ascending: false, nullsFirst: false });

  if (scope.sucursalId) {
    query = query.eq('sucursal_id', scope.sucursalId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      apiErrorPayload(
        'arca',
        error.message,
        'No pudimos cargar el centro de errores fiscales. Probá de nuevo en unos minutos.',
      ),
      { status: 500 },
    );
  }

  /** Todos los `error_arca` y `pendiente_arca` (sin exigir N intentos): misma visibilidad que cobros QR/efectivo en cola. */
  return NextResponse.json({ items: data ?? [] });
}
