import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import {
  ejecutarConfirmacionImportado,
  parseConfirmarImportadoLectorJson,
  TIPOS_PERMITIDOS_CONFIRMAR_IMPORTADO,
  validarItemsConfirmarImportado,
} from '@/lib/lector-facturas/ejecutar-confirmacion-importado';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';

export async function POST(request: Request) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const visorBlock = rejectIfVisor(session.rol);
  if (visorBlock) return visorBlock;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const body = parseConfirmarImportadoLectorJson(raw);
  if (!body) {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  if (!TIPOS_PERMITIDOS_CONFIRMAR_IMPORTADO.has(body.tipo_comprobante)) {
    return NextResponse.json({ error: 'tipo_comprobante no permitido' }, { status: 400 });
  }

  const errItems = validarItemsConfirmarImportado(body);
  if (errItems) {
    return NextResponse.json({ error: errItems }, { status: 400 });
  }
  const sucursalScope = await resolveAndValidateSucursalScope(
    session,
    String((body as { sucursal_id?: string }).sucursal_id ?? '').trim() || null,
  );
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const result = await ejecutarConfirmacionImportado(
    session.supabase,
    session.tenantId,
    sucursalScope.sucursalId,
    session.userId,
    body,
    'lector',
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.detalle != null ? { detalle: result.detalle } : {}) },
      { status: result.status },
    );
  }

  return NextResponse.json({
    comprobante_id: result.comprobante_id,
    actualizaciones_costos: result.actualizaciones_costos,
    pdf_url: null as string | null,
  });
}
