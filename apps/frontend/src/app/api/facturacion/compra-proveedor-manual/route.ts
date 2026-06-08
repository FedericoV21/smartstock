import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import {
  ejecutarConfirmacionImportado,
  parseCompraProveedorManualJson,
  validarItemsConfirmarImportado,
} from '@/lib/lector-facturas/ejecutar-confirmacion-importado';
import { moduloGuard } from '@/lib/modulos/guard';

/** Compra recibida cargada a mano (misma lógica que confirmar del lector, sin extracción IA). */
const TIPOS_MANUAL_COMPRA = new Set<string>(['factura_a', 'factura_b', 'factura_c', 'remito']);

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_simple');
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

  const body = parseCompraProveedorManualJson(raw);
  if (!body) {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  if (!TIPOS_MANUAL_COMPRA.has(body.tipo_comprobante)) {
    return NextResponse.json(
      { error: 'Para compras manuales usá Factura A/B/C o Remito' },
      { status: 400 },
    );
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
    'manual',
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
